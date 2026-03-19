document.addEventListener('DOMContentLoaded', () => {
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const saveBtn = document.getElementById('saveBtn');
    const statusTitle = document.getElementById('statusTitle');
    const statusDot = document.getElementById('statusDot');
    
    // Elements
    const elements = {
        targetUsername: document.getElementById('targetUsername'),
        messageTemplate: document.getElementById('messageTemplate'),
        restrictedLocs: document.getElementById('restrictedLocs'),
        minBatch: document.getElementById('minBatch'),
        maxBatch: document.getElementById('maxBatch'),
        minSleep: document.getElementById('minSleep'),
        maxSleep: document.getElementById('maxSleep'),
        sentToday: document.getElementById('sentToday'),
        skippedToday: document.getElementById('skippedToday'),
        nextBatchTime: document.getElementById('nextBatchTime')
    };
    
    function updateStatsUI(stats, nextTime) {
        if (stats) {
            // Check if it's a new day, if not show the count
            const today = new Date().toDateString();
            if (stats.lastUpdated === today) {
                elements.sentToday.textContent = stats.sentToday || 0;
                elements.skippedToday.textContent = stats.skippedToday || 0;
            } else {
                elements.sentToday.textContent = 0;
                elements.skippedToday.textContent = 0;
            }
        }
        if (nextTime) {
            elements.nextBatchTime.textContent = nextTime;
        }
    }

    // Live update listener
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local') {
            chrome.storage.local.get(['stats', 'nextBatchTime'], (res) => {
                updateStatsUI(res.stats, res.nextBatchTime);
            });
            if (changes.state) {
                const isRunning = changes.state.newValue?.running;
                if (isRunning) {
                    statusTitle.textContent = "Bot: Running";
                    statusTitle.style.color = "#28a745";
                    statusDot.classList.add("active");
                    startBtn.disabled = true;
                    stopBtn.disabled = false;
                } else {
                    statusTitle.textContent = "Bot: Stopped";
                    statusTitle.style.color = "#333";
                    statusDot.classList.remove("active");
                    startBtn.disabled = false;
                    stopBtn.disabled = true;
                }
            }
        }
    });

    // --- Scheduled Messages ---
    const addScheduleBtn = document.getElementById('addScheduleBtn');
    const scheduleDateInput = document.getElementById('scheduleDate');
    const scheduleMessageInput = document.getElementById('scheduleMessage');
    const scheduleListEl = document.getElementById('scheduleList');
    const todayIndicator = document.getElementById('todayIndicator');

    // Set date input default to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    scheduleDateInput.value = tomorrow.toISOString().split('T')[0];

    function renderScheduleList(scheduled) {
        scheduleListEl.innerHTML = '';
        if (!scheduled || scheduled.length === 0) {
            scheduleListEl.innerHTML = '<p class="hint" style="margin:4px 0;">No scheduled messages yet.</p>';
            return;
        }

        // Sort by date ascending
        scheduled.sort((a, b) => a.date.localeCompare(b.date));

        const todayStr = new Date().toISOString().split('T')[0];

        for (const item of scheduled) {
            const row = document.createElement('div');
            row.className = 'schedule-item';
            if (item.date === todayStr) row.classList.add('today');

            const dateLabel = document.createElement('span');
            dateLabel.className = 'schedule-date';
            const d = new Date(item.date + 'T00:00:00');
            dateLabel.textContent = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            if (item.date === todayStr) dateLabel.textContent += ' (TODAY)';

            const msgPreview = document.createElement('span');
            msgPreview.className = 'schedule-preview';
            msgPreview.textContent = item.message.length > 60 ? item.message.substring(0, 60) + '...' : item.message;
            msgPreview.title = item.message;

            const delBtn = document.createElement('button');
            delBtn.className = 'schedule-del';
            delBtn.textContent = '✕';
            delBtn.addEventListener('click', () => removeScheduledMessage(item.date));

            row.appendChild(dateLabel);
            row.appendChild(msgPreview);
            row.appendChild(delBtn);
            scheduleListEl.appendChild(row);
        }

        // Update today indicator
        const todayEntry = scheduled.find(s => s.date === todayStr);
        if (todayEntry) {
            todayIndicator.textContent = '✓ A scheduled message is active for today';
            todayIndicator.style.color = '#28a745';
        } else {
            todayIndicator.textContent = 'No scheduled message for today — using default template';
            todayIndicator.style.color = '#888';
        }
    }

    function removeScheduledMessage(date) {
        chrome.storage.local.get(['scheduledMessages'], (res) => {
            let scheduled = res.scheduledMessages || [];
            scheduled = scheduled.filter(s => s.date !== date);
            chrome.storage.local.set({ scheduledMessages: scheduled }, () => {
                renderScheduleList(scheduled);
            });
        });
    }

    addScheduleBtn.addEventListener('click', () => {
        const date = scheduleDateInput.value;
        const message = scheduleMessageInput.value.trim();
        if (!date || !message) {
            addScheduleBtn.textContent = 'Fill in both fields!';
            setTimeout(() => addScheduleBtn.textContent = '+ Add Scheduled Message', 1500);
            return;
        }
        chrome.storage.local.get(['scheduledMessages'], (res) => {
            let scheduled = res.scheduledMessages || [];
            // Replace if same date exists
            scheduled = scheduled.filter(s => s.date !== date);
            scheduled.push({ date, message });
            chrome.storage.local.set({ scheduledMessages: scheduled }, () => {
                scheduleMessageInput.value = '';
                addScheduleBtn.textContent = 'Added!';
                setTimeout(() => addScheduleBtn.textContent = '+ Add Scheduled Message', 1500);
                renderScheduleList(scheduled);
            });
        });
    });

    // Load state
    chrome.storage.local.get(['config', 'state', 'stats', 'nextBatchTime', 'scheduledMessages'], (res) => {
        // Render schedule list
        renderScheduleList(res.scheduledMessages || []);
        if (res.config) {
            elements.targetUsername.value = res.config.targetUsername || "";
            elements.messageTemplate.value = res.config.messageTemplate || "";
            elements.restrictedLocs.value = res.config.restrictedLocs || "bangladesh, india, pakistan, egypt, philippines, nigeria, kenya, ghana, south africa, uganda, africa";
            elements.minBatch.value = res.config.minBatch || 10;
            elements.maxBatch.value = res.config.maxBatch || 30;
            elements.minSleep.value = res.config.minSleep || 30;
            elements.maxSleep.value = res.config.maxSleep || 90;
        }
        
        if (res.state && res.state.running) {
            statusTitle.textContent = "Bot: Running";
            statusTitle.style.color = "#28a745";
            statusDot.classList.add("active");
            startBtn.disabled = true;
            stopBtn.disabled = false;
        } else {
            startBtn.disabled = false;
            stopBtn.disabled = true;
        }
        
        updateStatsUI(res.stats, res.nextBatchTime);
    });

    saveBtn.addEventListener('click', () => {
        // Handle Importing Memory from Python!
        const importBox = document.getElementById('importMemory').value;
        if (importBox && importBox.trim().startsWith('[')) {
            try {
                const importedArray = JSON.parse(importBox);
                chrome.storage.local.get(['already_messaged'], (res) => {
                    let existing = res.already_messaged || [];
                    let combined = [...new Set([...existing, ...importedArray])];
                    chrome.storage.local.set({ already_messaged: combined });
                    document.getElementById('importMemory').value = ""; // Clear box on success
                    saveBtn.textContent = "Memory Imported & Saved!";
                });
            } catch (e) {
                console.error("Failed to parse imported memory.", e);
            }
        }
        
        const config = {
            targetUsername: elements.targetUsername.value,
            messageTemplate: elements.messageTemplate.value,
            restrictedLocs: elements.restrictedLocs.value,
            minBatch: parseInt(elements.minBatch.value),
            maxBatch: parseInt(elements.maxBatch.value),
            minSleep: parseInt(elements.minSleep.value),
            maxSleep: parseInt(elements.maxSleep.value),
        };
        chrome.storage.local.set({ config: config }, () => {
            saveBtn.textContent = "Saved!";
            setTimeout(() => saveBtn.textContent = "Save Settings", 1500);
        });
    });

    startBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: "START_BOT" });
        statusTitle.textContent = "Bot: Running";
        statusTitle.style.color = "#28a745";
        statusDot.classList.add("active");
        startBtn.disabled = true;
        stopBtn.disabled = false;
    });

    stopBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: "STOP_BOT" });
        statusTitle.textContent = "Bot: Stopped";
        statusTitle.style.color = "#333";
        statusDot.classList.remove("active");
        startBtn.disabled = false;
        stopBtn.disabled = true;
    });
});
