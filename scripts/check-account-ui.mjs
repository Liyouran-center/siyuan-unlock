import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';

// Exercise the real settings registration without mounting unrelated panels.
const upstream = process.argv[2];
assert.ok(upstream, 'Usage: node scripts/check-account-ui.mjs <patched-upstream>');
const load = path => stripTypeScriptTypes(readFileSync(resolve(upstream, path), 'utf8'))
    .replace(/^import .*;$/gm, '').replace(/^export /gm, '');
// Helper modules that only exist in some upstream versions are loaded when present.
const loadIfExists = path => existsSync(resolve(upstream, path)) ? load(path) : '';
const source = load('app/src/config/tabs/syncTab.ts');
const groups = [];
const group = new Proxy({}, {get: () => () => {}});
const context = {
    window: {siyuan: {languages: {}, config: {system: {container: 'docker'}}}},
    getSyncProviderConfigKeywords: () => [],
    getSyncProviderConfigRowKeywords: () => [],
    mountSyncProvider() {},
    mountSyncAssetDownloadMode() {},
    mountLANSyncStatus() {},
    getLANSyncSearchAvailability() {},
    registerAccountGroup() { groups.push('account'); },
    tab: {group(id) { groups.push(id); return group; }},
};
runInNewContext(`${source}\nregisterSyncTab(tab);`, context);
assert.deepEqual(groups, ['sync', 'repo'], 'Sync settings must contain no account/login group');
console.log('PASS: sync settings register only sync and local repository groups');

// Each queried selector gets its own container, so the intro and config row are checked separately.
const makeElement = () => ({
    innerHTML: '',
    classList: {toggle() {}},
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
});
let containers = new Map();
const root = {
    querySelector(selector) {
        if (!containers.has(selector)) {
            containers.set(selector, makeElement());
        }
        return containers.get(selector);
    },
};
const syncContext = {
    window: {siyuan: {user: {userSiYuanOneTimePayStatus: 1}, languages: {_kernel: {214: 'LOGIN_REQUIRED'}},
        config: {sync: {provider: 2, s3: {}, webdav: {}}}}},
    getCloudURL: () => '',
    getHostCapabilities: () => ({importExport: false}),
    root,
};
const renderSource = loadIfExists('app/src/util/escape.ts') + '\n' + load('app/src/util/needSubscribe.ts') + '\n' + load('app/src/config/tabs/syncUi.ts');
const render = () => {
    containers = new Map();
    runInNewContext(`${renderSource}\nrenderProviderConfig(root);`, {...syncContext});
    return [...containers.values()].map(element => element.innerHTML).join('\n');
};
// Editable means either the legacy inline endpoint field or an enabled configuration button.
const editable = /id="endpoint"|data-action="configureSync"(?![^>]*disabled)/;
for (const provider of [2, 3]) {
    syncContext.window.siyuan.config.sync.provider = provider;
    const html = render();
    assert.match(html, editable, 'Third-party sync configuration must be editable');
    assert.doesNotMatch(html, /LOGIN_REQUIRED/);
}
syncContext.window.siyuan.user = null;
const blocked = render();
assert.match(blocked, /LOGIN_REQUIRED/, 'Control case must detect the reported missing-user regression');
assert.doesNotMatch(blocked, editable, 'Control case must not expose an editable configuration');
console.log('PASS: S3/WebDAV configuration renders for local unlock state; missing-user control is blocked');
