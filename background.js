const BG_VERSION = "v5-2026-03-21";
console.log(`[BOT] Background script loaded. Version: ${BG_VERSION}`);

let isProcessing = false;

// Send a message to a tab with a timeout
function sendTabMessage(tabId, message, timeoutMs = 90000) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            console.warn(`[BOT] TIMEOUT after ${timeoutMs/1000}s: ${message.action}`);
            resolve({ error: `Timed out (${message.action})` });
        }, timeoutMs);

        try {
            chrome.tabs.sendMessage(tabId, message, (response) => {
                clearTimeout(timer);
                if (chrome.runtime.lastError) {
                    console.warn("[BOT] Tab message error:", chrome.runtime.lastError.message);
                    resolve({ error: chrome.runtime.lastError.message });
                } else {
                    resolve(response || { error: "No response from content script" });
                }
            });
        } catch (err) {
            clearTimeout(timer);
            resolve({ error: err.toString() });
        }
    });
}

// Wait for tab to finish loading
function waitForTabLoad(tabId, timeoutMs = 15000) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(), timeoutMs);
        const listener = (updatedTabId, changeInfo) => {
            if (updatedTabId === tabId && changeInfo.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                clearTimeout(timer);
                // Extra wait for content script to initialize
                setTimeout(resolve, 2000);
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "START_BOT") {
        if (!isProcessing) {
            chrome.storage.local.set({ state: { running: true } });
            console.log("[BOT] Started!");
            startScrapingCycle();
        }
    } else if (request.action === "STOP_BOT") {
        chrome.storage.local.set({ state: { running: false } });
        chrome.alarms.clear("nextCycle");
        isProcessing = false;
        console.log("[BOT] Stopped.");
    }
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "nextCycle") {
        chrome.storage.local.get(['state'], (res) => {
            if (res.state && res.state.running) {
                console.log("[BOT] Alarm triggered. Starting new cycle...");
                startScrapingCycle();
            }
        });
    }
});

async function startScrapingCycle() {
    isProcessing = true;
    chrome.storage.local.set({ nextBatchTime: "Active in Background..." });

    const data = await new Promise(resolve =>
        chrome.storage.local.get(['config', 'messaged_today', 'stats', 'scheduledMessages'], resolve)
    );
    const config = data.config || {};

    const todayStr = new Date().toDateString();
    let stats = data.stats || { sentToday: 0, skippedToday: 0, lastUpdated: todayStr };
    let messaged_today = data.messaged_today || { date: todayStr, users: [] };

    if (stats.lastUpdated !== todayStr) {
        stats = { sentToday: 0, skippedToday: 0, lastUpdated: todayStr };
    }
    if (messaged_today.date !== todayStr) {
        messaged_today = { date: todayStr, users: [] };
        await new Promise(r => chrome.storage.local.set({ messaged_today }, r));
        console.log("[BOT] New day. Daily list cleared.");
    }

    const scheduledMessages = data.scheduledMessages || [];
    const todayISO = new Date().toISOString().split('T')[0];
    const todayScheduled = scheduledMessages.find(s => s.date === todayISO);
    const activeMessage = todayScheduled ? todayScheduled.message : config.messageTemplate;

    if (todayScheduled) {
        console.log(`[BOT] Using scheduled message for ${todayISO}`);
    }

    if (!config.targetUsername || !activeMessage) {
        console.error("[BOT] Target username or message missing.");
        finishCycle(config);
        return;
    }

    // Step 1: Open profile page and scrape viewers
    chrome.tabs.create({ url: `https://www.instagram.com/${config.targetUsername}/`, active: true }, async (tab) => {
        await waitForTabLoad(tab.id);
        await new Promise(r => setTimeout(r, 3000)); // Extra buffer

        let batchTarget = Math.floor(Math.random() * ((config.maxBatch||30) - (config.minBatch||10) + 1)) + (config.minBatch||10);
        console.log(`[BOT] Batch target: ${batchTarget}`);

        try {
            // Scrape viewers
            const scrapeRes = await sendTabMessage(tab.id, { action: "SCRAPE_VIEWERS" }, 120000);

            if (!scrapeRes || !scrapeRes.success) {
                console.error("[BOT] Scraping failed:", scrapeRes ? scrapeRes.error : "No response");
                finishCycle(config);
                return;
            }

            const viewers = scrapeRes.viewers;
            console.log(`[BOT] Scraped ${viewers.length} viewers.`);

            const freshViewers = viewers.filter(v => !messaged_today.users.includes(v));
            const targetViewers = freshViewers.slice(0, batchTarget);
            console.log(`[BOT] ${freshViewers.length} fresh viewers. Targeting ${targetViewers.length}.`);

            if (targetViewers.length === 0) {
                console.log("[BOT] Nobody new to message.");
                finishCycle(config);
                return;
            }

            // Restricted locations list
            const locs = (config.restrictedLocs || "").split(",").map(s => s.trim().toLowerCase()).filter(s => s);

            let sentCount = 0;

            for (const user of targetViewers) {
                // Check stop signal
                const stateCheck = await new Promise(r => chrome.storage.local.get(['state'], r));
                if (!stateCheck.state || !stateCheck.state.running) {
                    console.log("[BOT] Stop signal received.");
                    finishCycle(config, true);
                    return;
                }

                console.log(`[BOT] ---- Processing: ${user} ----`);

                // ==============================
                // STEP A: Visit profile page to check location
                // ==============================
                if (locs.length > 0) {
                    console.log(`[BOT] Visiting profile: instagram.com/${user}/`);
                    await new Promise(r => chrome.tabs.update(tab.id, { url: `https://www.instagram.com/${user}/` }, r));
                    await waitForTabLoad(tab.id);
                    await new Promise(r => setTimeout(r, 2000));

                    const profileRes = await sendTabMessage(tab.id, { action: "SCAN_PROFILE" }, 15000);

                    if (profileRes && profileRes.success && profileRes.bioText) {
                        const bioText = profileRes.bioText.toLowerCase();
                        let locationMatch = null;

                        for (const loc of locs) {
                            if (bioText.includes(loc)) {
                                locationMatch = loc;
                                break;
                            }
                        }

                        if (locationMatch) {
                            console.log(`[BOT] SKIPPED ${user}: bio contains "${locationMatch}"`);
                            messaged_today.users.push(user);
                            stats.skippedToday += 1;
                            await new Promise(r => chrome.storage.local.set({ messaged_today, stats }, r));
                            continue; // Skip to next user
                        }
                    }
                    console.log(`[BOT] ${user} passed location check.`);
                }

                // ==============================
                // STEP B: Go to /direct/ and send message
                // ==============================
                console.log(`[BOT] Navigating to /direct/ for ${user}...`);
                await new Promise(r => chrome.tabs.update(tab.id, { url: "https://www.instagram.com/direct/" }, r));
                await waitForTabLoad(tab.id);
                await new Promise(r => setTimeout(r, 3000));

                const sendRes = await sendTabMessage(tab.id, {
                    action: "SEND_MESSAGE",
                    username: user,
                    messageTemplate: activeMessage
                }, 90000);

                if (sendRes && sendRes.success) {
                    messaged_today.users.push(user);
                    sentCount++;
                    stats.sentToday += 1;
                    await new Promise(r => chrome.storage.local.set({ messaged_today, stats }, r));
                    console.log(`[BOT] SUCCESS: Sent to ${user} (${sentCount} total)`);

                    // Break between messages
                    const breakMs = Math.floor(Math.random() * (15000 - 10000 + 1) + 10000);
                    await new Promise(r => setTimeout(r, breakMs));
                } else {
                    console.log(`[BOT] FAILED for ${user}:`, sendRes ? sendRes.error : "Unknown error");
                    // Don't add to messaged_today — will retry next cycle
                }
            }

            console.log(`[BOT] Batch complete. Sent ${sentCount} messages.`);
            finishCycle(config);

        } catch (err) {
            console.error("[BOT] Cycle error:", err);
            finishCycle(config);
        }
    });
}

function finishCycle(config, forceStop = false) {
    isProcessing = false;
    if (forceStop) {
        chrome.storage.local.set({ nextBatchTime: "Stopped" });
        return;
    }
    const sleepMinutes = Math.floor(Math.random() * ((config.maxSleep||90) - (config.minSleep||30) + 1)) + (config.minSleep||30);
    console.log(`[BOT] Sleeping ${sleepMinutes} minutes...`);

    const nextTime = new Date(Date.now() + sleepMinutes * 60000);
    const timeString = nextTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    chrome.storage.local.set({ nextBatchTime: `Waiting... Next run at ${timeString}` });
    chrome.alarms.create("nextCycle", { delayInMinutes: sleepMinutes });
}
