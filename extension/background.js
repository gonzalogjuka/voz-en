const ENGINE_URL = chrome.runtime.getURL('engine.html');

chrome.action.onClicked.addListener(async () => {
  const wins = await chrome.windows.getAll({ populate: true, windowTypes: ['popup'] });
  const open = wins.find((w) => w.tabs?.some((t) => t.url?.startsWith(ENGINE_URL)));
  if (open) return chrome.windows.update(open.id, { focused: true });
  chrome.windows.create({ url: ENGINE_URL, type: 'popup', width: 460, height: 640 });
});

// tabId -> true while the meeting app holds our wrapped microphone.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'mic-active' && sender.tab) {
    chrome.storage.session.get('active').then(({ active = {} }) => {
      const key = `${sender.tab.id}:${sender.frameId}`;
      if (msg.active) active[key] = true;
      else delete active[key];
      chrome.storage.session.set({ active });
    });
  } else if (msg.type === 'status') {
    chrome.storage.session.get('active').then(({ active = {} }) => reply(Object.keys(active)));
    return true;
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { active = {} } = await chrome.storage.session.get('active');
  for (const k of Object.keys(active)) if (k.startsWith(`${tabId}:`)) delete active[k];
  chrome.storage.session.set({ active });
});
