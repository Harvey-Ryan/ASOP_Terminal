// safeReturnPath (v1.12.0): only dashboard pages on our own site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeReturnPath } from '../dist/index.js';

test('dashboard pages, with their query and hash, are kept', () => {
  for (const p of ['/dashboard', '/dashboard/servers/111/events/abc/loot', '/dashboard/servers/111?tab=pending', '/dashboard/kanban#x']) {
    assert.equal(safeReturnPath(p), p);
  }
});

test('anything that could leave the site, or isn\'t a dashboard page, is refused', () => {
  for (const p of ['https://evil.example/dashboard', '//evil.example/dashboard', '/dashboard//evil.example', '/\\evil.example',
    '/dashboard\\..\\x', '/dashboardx', '/login', '/', '', 'dashboard', '/dashboard/\nSet-Cookie:x', '/dashboard/' + 'a'.repeat(600), null, 42, ['/dashboard']]) {
    assert.equal(safeReturnPath(p), null, String(p).slice(0, 40));
  }
});
