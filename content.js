const CONTENT_VERSION = "v5-2026-03-21";
console.log(`[BOT] Content script loaded. Version: ${CONTENT_VERSION}`);

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function humanDelay(minSec, maxSec) {
    const ms = Math.floor(Math.random() * (maxSec - minSec + 1) + minSec) * 1000;
    return sleep(ms);
}

// SAFE text reader — uses .textContent (no layout reflow, instant)
function safeText(el) {
    if (!el) return "";
    return (el.textContent || "").trim();
}

// Find element by text using .textContent (safe, no reflow)
function findByText(selector, text, exact = true) {
    const els = document.querySelectorAll(selector);
    const lowerText = text.toLowerCase();
    for (const el of els) {
        const t = (el.textContent || "").trim().toLowerCase();
        if (exact ? t === lowerText : t.includes(lowerText)) {
            return el;
        }
    }
    return null;
}

// ==========================================
// ACTION 1: SCRAPE VIEWERS from story page
// ==========================================
async function scrapeViewers() {
    console.log("[BOT] === SCRAPE VIEWERS START ===");
    try {
        const storyRing = document.querySelector("header canvas");
        if (!storyRing) return { error: "No active story found on this profile." };
        storyRing.click();
        console.log("[BOT] Story ring clicked. Waiting for story to load...");

        await humanDelay(3, 5);

        // Find and click "Seen by" or viewers icon
        let clickedViewers = false;

        const seenBySpan = findByText("span", "seen by", false);
        if (seenBySpan) {
            console.log("[BOT] Found 'Seen by' text. Clicking...");
            const btn = seenBySpan.closest('button') || seenBySpan.closest('div[role="button"]');
            if (btn) btn.click(); else seenBySpan.click();
            clickedViewers = true;
        }

        if (!clickedViewers) {
            const eyeIcon = document.querySelector('svg[aria-label*="viewer" i], svg[aria-label*="Seen" i]');
            if (eyeIcon) {
                console.log("[BOT] Found viewers icon. Clicking...");
                const btn = eyeIcon.closest('button') || eyeIcon.closest('div[role="button"]') || eyeIcon.parentElement;
                if (btn) btn.click();
                clickedViewers = true;
            }
        }

        if (!clickedViewers) {
            const viewersSpan = findByText("span", "viewers", false);
            if (viewersSpan) {
                console.log("[BOT] Found 'Viewers' text. Clicking...");
                const btn = viewersSpan.closest('button') || viewersSpan.closest('div[role="button"]');
                if (btn) btn.click(); else viewersSpan.click();
                clickedViewers = true;
            }
        }

        if (!clickedViewers) return { error: "'Seen by / Viewers' button not found." };

        await humanDelay(2, 3);

        // Find the VIEWERS dialog (not the story overlay)
        console.log("[BOT] Looking for viewers dialog...");
        let viewersDialog = null;
        const allDialogs = document.querySelectorAll('div[role="dialog"]');
        console.log(`[BOT] Found ${allDialogs.length} dialog(s) on page.`);

        if (allDialogs.length === 0) return { error: "No dialog found on page." };

        for (let i = allDialogs.length - 1; i >= 0; i--) {
            const d = allDialogs[i];
            const hasViewersTitle = !!Array.from(d.querySelectorAll("span")).find(s =>
                (s.textContent || "").trim().toLowerCase() === "viewers"
            );
            const profileLinks = d.querySelectorAll('a[href^="/"]');
            let profileLinkCount = 0;
            for (const link of profileLinks) {
                const href = link.getAttribute('href') || "";
                const parts = href.replace(/^\//, '').replace(/\/$/, '');
                if (parts && !parts.includes('/') && !parts.includes('?') && parts !== 'direct' && parts !== 'explore') {
                    profileLinkCount++;
                }
            }
            const profilePics = d.querySelectorAll('img[alt*="profile picture"]');
            console.log(`[BOT] Dialog ${i}: title=${hasViewersTitle}, links=${profileLinkCount}, pics=${profilePics.length}`);

            if (hasViewersTitle || profileLinkCount >= 2 || profilePics.length >= 2) {
                viewersDialog = d;
                console.log(`[BOT] Selected dialog ${i} as viewers dialog.`);
                break;
            }
        }

        if (!viewersDialog) {
            viewersDialog = allDialogs[allDialogs.length - 1];
            console.log("[BOT] Fallback: using last dialog.");
        }

        // Collect usernames
        function collectUsernames() {
            const viewers = new Set();
            const links = viewersDialog.querySelectorAll("a[href]");
            for (const link of links) {
                const href = link.getAttribute('href') || "";
                if (href.startsWith('/') && !href.includes('/p/') && !href.includes('/reel/') && !href.includes('/stories/')) {
                    const un = href.replace(/^\//, '').replace(/\/$/, '');
                    if (un && !un.includes('/') && !un.includes('?') && un !== 'direct' && un !== 'explore' && un !== 'accounts') {
                        viewers.add(un);
                    }
                }
            }
            if (viewers.size === 0) {
                const imgs = viewersDialog.querySelectorAll('img[alt]');
                for (const img of imgs) {
                    const alt = img.getAttribute('alt') || "";
                    if (alt.includes("profile picture")) {
                        const un = alt.split("'")[0].trim();
                        if (un && un.length > 0 && !un.includes(' ')) viewers.add(un);
                    }
                }
            }
            if (viewers.size === 0) {
                const items = viewersDialog.querySelectorAll('li, div[role="listitem"], div[role="row"]');
                for (const item of items) {
                    for (const span of item.querySelectorAll('span')) {
                        const text = (span.textContent || "").trim();
                        if (text && /^[a-z0-9._]{1,30}$/.test(text)) viewers.add(text);
                    }
                }
            }
            return viewers;
        }

        // Find scrollable container
        let scrollTarget = null;
        for (const div of viewersDialog.querySelectorAll('div')) {
            const style = window.getComputedStyle(div);
            if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && div.scrollHeight > div.clientHeight) {
                scrollTarget = div;
            }
        }
        if (!scrollTarget) scrollTarget = viewersDialog;

        // Scroll to load all viewers
        let lastCount = 0;
        let noChangeRuns = 0;
        for (let round = 0; round < 40; round++) {
            const count = collectUsernames().size;
            if (count > lastCount) {
                console.log(`[BOT] Round ${round}: ${count} viewers`);
                lastCount = count;
                noChangeRuns = 0;
                scrollTarget.scrollTop = scrollTarget.scrollHeight;
                await sleep(1500);
            } else {
                noChangeRuns++;
                scrollTarget.scrollTop = scrollTarget.scrollHeight;
                await sleep(500);
                if (noChangeRuns >= 5) break;
            }
        }

        const finalViewers = collectUsernames();
        console.log(`[BOT] === SCRAPE COMPLETE: ${finalViewers.size} viewers ===`);

        // Close dialogs
        try {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
            await sleep(500);
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
        } catch(e) {}

        return { success: true, viewers: Array.from(finalViewers) };
    } catch (e) {
        console.error("[BOT] scrapeViewers error:", e);
        return { error: e.toString() };
    }
}

// ==========================================
// ACTION 2: SCAN PROFILE for location info
// Called on the user's profile page (instagram.com/username/)
// This page has clean DOM — just bio, name, stats
// ==========================================
async function scanProfile() {
    console.log("[BOT] === SCAN PROFILE START ===");
    try {
        // Wait for profile to load
        await sleep(2000);

        let bioText = "";

        // Read the bio/description section
        // On a profile page, the bio is in a specific section with spans
        const mainArea = document.querySelector('main') || document.querySelector('div[role="main"]') || document.body;

        // Strategy 1: Find the header section which contains name + bio
        const header = mainArea.querySelector('header');
        if (header) {
            // Read the section AFTER the header (contains bio text)
            const headerParent = header.parentElement;
            if (headerParent) {
                // Get all spans in the header parent area (name, bio, link)
                const spans = headerParent.querySelectorAll('span');
                for (const span of spans) {
                    const text = (span.textContent || "").trim();
                    if (text.length > 0 && text.length < 300) {
                        bioText += " " + text.toLowerCase();
                    }
                }
            }
        }

        // Strategy 2: Also read any link in the bio area
        const bioLinks = mainArea.querySelectorAll('a[href]');
        for (const link of bioLinks) {
            const text = (link.textContent || "").trim();
            if (text.length > 0 && text.length < 200) {
                bioText += " " + text.toLowerCase();
            }
        }

        console.log(`[BOT] Profile bio text: ${bioText.length} chars`);
        console.log(`[BOT] Bio preview: "${bioText.substring(0, 200)}"`);

        return { success: true, bioText: bioText };
    } catch (e) {
        console.error("[BOT] scanProfile error:", e);
        return { success: true, bioText: "" }; // Don't block messaging on scan errors
    }
}

// ==========================================
// ACTION 3: SEND MESSAGE on the /direct/ page
// NO location scanning here — that's done separately on the profile page
// ==========================================
async function sendMessage(username, messageData) {
    console.log(`[BOT] === SEND MESSAGE to ${username} ===`);

    await humanDelay(3, 5);

    // Dismiss "Not Now" popup
    try {
        const notNow = findByText('button', 'Not Now');
        if (notNow) { notNow.click(); console.log("[BOT] Dismissed 'Not Now'."); }
    } catch(e) {}

    // Step 1: Click pencil icon
    console.log("[BOT] Step 1: Looking for pencil icon...");
    const pencil = document.querySelector('svg[aria-label="New message"], svg[aria-label="New Message"]');
    if (!pencil) return { error: "Pencil icon not found." };
    const pencilBtn = pencil.closest('div[role="button"]') || pencil.parentElement;
    if (pencilBtn) pencilBtn.click();
    console.log("[BOT] Pencil clicked.");
    await humanDelay(2, 3);

    // Step 2: Search username
    console.log(`[BOT] Step 2: Searching for ${username}...`);
    const searchInput = document.querySelector('input[placeholder="Search..."], input[name="queryBox"]');
    if (!searchInput) return { error: "Search input not found." };
    searchInput.focus();
    document.execCommand('insertText', false, username);
    await humanDelay(3, 5);

    // Step 3: Click on user in results
    console.log("[BOT] Step 3: Clicking user in results...");
    const userResult = findByText('span', username);
    if (!userResult) return { error: `User "${username}" not found in search.` };
    userResult.click();
    await humanDelay(1, 2);

    // Step 4: Click Chat/Next button
    console.log("[BOT] Step 4: Looking for Chat/Next button...");
    const chatBtn = findByText('div[role="button"]', 'Chat') || findByText('div[role="button"]', 'Next');
    if (chatBtn) {
        chatBtn.click();
        console.log("[BOT] Chat/Next clicked.");
    } else {
        console.log("[BOT] No Chat/Next button — may have opened directly.");
    }
    await humanDelay(4, 6);

    // Step 5: Find textbox and type message
    // NO LOCATION SCANNING HERE — it was already done on the profile page
    console.log("[BOT] Step 5: Looking for textbox...");
    const textboxes = document.querySelectorAll('div[contenteditable="true"], textarea, div[role="textbox"]');
    if (textboxes.length === 0) return { error: "Textbox not found." };

    let textbox = null;
    for (const tb of textboxes) {
        if (tb.offsetParent !== null) textbox = tb;
    }
    if (!textbox) textbox = textboxes[textboxes.length - 1];

    console.log("[BOT] Typing message...");
    textbox.focus();
    await sleep(500);
    let target = textbox.querySelector('p') || textbox;
    target.focus();
    const msg = (!messageData || messageData.trim() === "") ? "Hey!" : messageData;
    document.execCommand('insertText', false, msg);
    target.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
    textbox.dispatchEvent(new Event('change', { bubbles: true }));
    await humanDelay(2, 3);

    // Step 6: Click Send
    console.log("[BOT] Step 6: Clicking Send...");
    const sendBtn = findByText('div[role="button"]', 'Send');
    if (sendBtn) {
        sendBtn.click();
        console.log(`[BOT] SENT to ${username}!`);
    } else {
        textbox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        console.log(`[BOT] Enter pressed for ${username}!`);
    }

    return { success: true };
}

// ==========================================
// MESSAGE LISTENER with timeouts
// ==========================================
function withTimeout(asyncFn, timeoutMs, timeoutMsg) {
    return Promise.race([
        asyncFn(),
        new Promise((_, reject) => setTimeout(() => reject(new Error(timeoutMsg)), timeoutMs))
    ]);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log(`[BOT] Received action: ${request.action}`);

    if (request.action === "SCRAPE_VIEWERS") {
        withTimeout(() => scrapeViewers(), 120000, "scrapeViewers timed out")
            .then(sendResponse)
            .catch(err => sendResponse({ error: err.toString() }));
        return true;
    }

    if (request.action === "SCAN_PROFILE") {
        withTimeout(() => scanProfile(), 15000, "scanProfile timed out")
            .then(sendResponse)
            .catch(err => sendResponse({ success: true, bioText: "" }));
        return true;
    }

    if (request.action === "SEND_MESSAGE") {
        withTimeout(
            () => sendMessage(request.username, request.messageTemplate),
            90000,
            `sendMessage timed out for ${request.username}`
        )
            .then(sendResponse)
            .catch(err => sendResponse({ error: err.toString() }));
        return true;
    }
});
