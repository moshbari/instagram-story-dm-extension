let isProcessing = false;

// Send a message to a tab with a timeout — prevents the bot from hanging forever
// if the content script doesn't respond (page loading, script crashed, etc.)
function sendTabMessage(tabId, message, timeoutMs = 90000) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            console.warn(`[BOT] Tab message timed out after ${timeoutMs/1000}s:`, message.action);
            resolve({ error: `Tab message timed out (${message.action})` });
        }, timeoutMs);

        try {
            chrome.tabs.sendMessage(tabId, message, (response) => {
                clearTimeout(timer);
                if (chrome.runtime.lastError) {
                    console.warn("[BOT] Tab message error:", chrome.runtime.lastError.message);
                    resolve({ error: chrome.runtime.lastError.message });
                } else {
                    resolve(response);
                }
            });
        } catch (err) {
            clearTimeout(timer);
            resolve({ error: err.toString() });
        }
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "START_BOT") {
        if (!isProcessing) {
            chrome.storage.local.set({ state: { running: true } });
            console.log("[BOT] Started. Scraper initiating...");
            startScrapingCycle();
        }
    } else if (request.action === "STOP_BOT") {
        chrome.storage.local.set({ state: { running: false } });
        chrome.alarms.clear("nextCycle");
        isProcessing = false;
        console.log("[BOT] completely stopped.");
    }
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "nextCycle") {
        chrome.storage.local.get(['state'], (res) => {
            if (res.state && res.state.running) {
                console.log("[BOT] Alarm triggered. Waking up to start scraping cycle...");
                startScrapingCycle();
            }
        });
    }
});

async function startScrapingCycle() {
    isProcessing = true;
    
    // Set status to currently actively working
    chrome.storage.local.set({ nextBatchTime: "Active in Background..." });
    
    // Get config
    const data = await new Promise(resolve => chrome.storage.local.get(['config', 'messaged_today', 'stats', 'scheduledMessages'], resolve));
    const config = data.config || {};

    // Initialize daily stats and daily messaged list — reset both at midnight
    const todayStr = new Date().toDateString();
    let stats = data.stats || { sentToday: 0, skippedToday: 0, lastUpdated: todayStr };
    let messaged_today = data.messaged_today || { date: todayStr, users: [] };

    if (stats.lastUpdated !== todayStr) {
        stats = { sentToday: 0, skippedToday: 0, lastUpdated: todayStr };
    }
    if (messaged_today.date !== todayStr) {
        messaged_today = { date: todayStr, users: [] };
        await new Promise(r => chrome.storage.local.set({ messaged_today }, r));
        console.log("[BOT] New day detected. Daily messaged list cleared.");
    }
    
    // Determine today's message: check scheduled messages first, fall back to default template
    const scheduledMessages = data.scheduledMessages || [];
    const todayISO = new Date().toISOString().split('T')[0];
    const todayScheduled = scheduledMessages.find(s => s.date === todayISO);
    const activeMessage = todayScheduled ? todayScheduled.message : config.messageTemplate;

    if (todayScheduled) {
        console.log(`[BOT] Using scheduled message for ${todayISO}`);
    } else {
        console.log(`[BOT] No scheduled message for ${todayISO}, using default template.`);
    }

    if (!config.targetUsername || !activeMessage) {
        console.error("[BOT] Target username or message missing in config.");
        finishCycle(config);
        return;
    }

    // Open Instagram in a new active tab to the user's profile
    chrome.tabs.create({ url: `https://www.instagram.com/${config.targetUsername}/`, active: true }, async (tab) => {
        // Wait for page load
        await new Promise(r => setTimeout(r, 6000));
        
        let batchTarget = Math.floor(Math.random() * ((config.maxBatch||30) - (config.minBatch||10) + 1)) + (config.minBatch||10);
        console.log(`[BOT] Target messages for this dynamic batch: ${batchTarget}`);
        
        // Command content.js to scrape (with 2-minute timeout)
        try {
            const scrapeRes = await sendTabMessage(tab.id, { action: "SCRAPE_VIEWERS" }, 120000);
            
            if (!scrapeRes || !scrapeRes.success) {
                console.error("[BOT] Scraping failed or no viewers found:", scrapeRes ? scrapeRes.error : "No response from tab.");
                finishCycle(config);
                return;
            }
            
            const viewers = scrapeRes.viewers;
            console.log(`[BOT] Scraped ${viewers.length} viewers.`);
            
            // Filter out viewers already messaged TODAY only
            const freshViewers = viewers.filter(v => !messaged_today.users.includes(v));
            const targetViewers = freshViewers.slice(0, batchTarget);

            console.log(`[BOT] Found ${freshViewers.length} not-yet-messaged-today viewers. Sending to ${targetViewers.length} people.`);
            
            if (targetViewers.length === 0) {
                console.log("[BOT] Nobody new to message. Ending cycle.");
                finishCycle(config);
                return;
            }
            
            let sentCount = 0;

            for (const user of targetViewers) {
                // Check stop signal mid-loop
                const stateCheck = await new Promise(r => chrome.storage.local.get(['state'], r));
                if (!stateCheck.state || !stateCheck.state.running) {
                    console.log("[BOT] Stop signal received mid-loop.");
                    finishCycle(config, true);
                    return;
                }
                
                console.log(`[BOT] Processing message flow for ${user}...`);
                
                // Redirect to /direct/ first to ensure pencil icon is visible
                await new Promise(r => chrome.tabs.update(tab.id, { url: "https://www.instagram.com/direct/" }, r));
                await new Promise(r => setTimeout(r, 8000)); // 8s to let page + content script fully load

                const sendRes = await sendTabMessage(tab.id, {
                    action: "SEND_MESSAGE",
                    username: user,
                    messageTemplate: activeMessage,
                    restrictedLocs: config.restrictedLocs
                }, 90000); // 90 second timeout per person
                
                if (sendRes && sendRes.success) {
                    messaged_today.users.push(user);
                    sentCount++;
                    stats.sentToday += 1;

                    // Update storage immediately
                    await new Promise(r => chrome.storage.local.set({ messaged_today, stats }, r));

                    // Biological break
                    const breakMs = Math.floor(Math.random() * (15000 - 10000 + 1) + 10000);
                    await new Promise(r => setTimeout(r, breakMs));
                } else if (sendRes && sendRes.skipped) {
                    console.log(`[BOT] Skipped intentionally: ${user}`);
                    // Mark as messaged today so we don't retry restricted people in this day's cycle
                    messaged_today.users.push(user);
                    stats.skippedToday += 1;
                    await new Promise(r => chrome.storage.local.set({ messaged_today, stats }, r));
                } else {
                    console.log(`[BOT] Failed to send to ${user}:`, sendRes ? sendRes.error : "Unknown error.");
                }
            }
            
            console.log(`[BOT] Batch complete. Sent ${sentCount} messages successfully.`);
            finishCycle(config);
            
        } catch (err) {
            console.error("[BOT] Cycle loop error:", err);
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
    console.log(`[BOT] Sleeping for ${sleepMinutes} minutes before next alarm natively...`);
    
    // Calculate the physical time
    const nextTime = new Date(Date.now() + sleepMinutes * 60000);
    const timeString = nextTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    chrome.storage.local.set({ nextBatchTime: `Waiting... Next run at ${timeString}` });
    chrome.alarms.create("nextCycle", { delayInMinutes: sleepMinutes });
}
