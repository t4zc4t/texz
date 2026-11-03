import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Message } from 'discord.js';
import { Store } from '../src/db.ts';
import { onText, definitions } from '../src/core/registry.ts';

function fake(content: string, opts: { admin?: boolean; channel?: string; roles?: string[] } = {}) {
  const replies: { content?: string; embeds?: { data: { title?: string; description?: string } }[] }[] = [];
  const m = {
    content,
    author: { id: 'u1', bot: false },
    guildId: 'g1',
    guild: null,
    channelId: opts.channel ?? 'c1',
    member: {
      permissions: { has: () => !!opts.admin },
      roles: { cache: new Map((opts.roles ?? []).map((r) => [r, {}])) },
    },
    reply: async (p: (typeof replies)[number]) => { replies.push(p); },
  } as unknown as Message;
  return { m, replies };
}

const tick = () => new Promise((r) => setTimeout(r, 10));
// everything a reply says, content and embed together
const said = (r: { content?: string; embeds?: { data: { title?: string; description?: string } }[] }) =>
  [r.content ?? '', ...(r.embeds ?? []).map((e) => `${e.data.title ?? ''}\n${e.data.description ?? ''}`)].join('\n');

test('every slash command has a unique name', () => {
  const names = definitions.map((d) => d.name);
  assert.equal(new Set(names).size, names.length);
});

test('prefix commands and aliases', async () => {
  const store = new Store(':memory:');
  const a = fake('tz status');
  assert.equal(onText(store, a.m), true);
  await tick();
  assert.match(said(a.replies[0]), /Case file/);

  const b = fake('TZ hb');
  assert.equal(onText(store, b.m), true);
  await tick();
  assert.match(said(b.replies[0]), /owo hb/);

  assert.equal(onText(store, fake('tzatziki is great').m), false);
  assert.equal(onText(store, fake('tz nothing').m), false);
  assert.equal(onText(store, fake('hello').m), false);
});

test('features switch off and stay admin only to change', async () => {
  const store = new Store(':memory:');
  const nope = fake('tz config feature owo off');
  onText(store, nope.m);
  await tick();
  assert.match(said(nope.replies[0]), /Manage Server|admin/i);

  const yes = fake('tz config feature owo off', { admin: true });
  onText(store, yes.m);
  await tick();
  assert.equal(store.rules('g1', 'owo').enabled, false);

  const blocked = fake('tz status');
  onText(store, blocked.m);
  await tick();
  assert.match(said(blocked.replies[0]), /locked here|switched it off|Closed for today/);
});

test('channel and role limits', async () => {
  const store = new Store(':memory:');
  onText(store, fake('tz config channel owo add <#222222222222222222>', { admin: true }).m);
  await tick();
  assert.deepEqual(store.rules('g1', 'owo').channels, ['222222222222222222']);

  const wrong = fake('tz status', { channel: 'c1' });
  onText(store, wrong.m);
  await tick();
  assert.match(said(wrong.replies[0]), /<#222222222222222222>/);

  const right = fake('tz status', { channel: '222222222222222222' });
  onText(store, right.m);
  await tick();
  assert.match(said(right.replies[0]), /Case file/);

  onText(store, fake('tz config role owo add <@&333333333333333333>', { admin: true }).m);
  await tick();
  const noRole = fake('tz status', { channel: '222222222222222222' });
  onText(store, noRole.m);
  await tick();
  assert.match(said(noRole.replies[0]), /role|select few/);
  const withRole = fake('tz status', { channel: '222222222222222222', roles: ['333333333333333333'] });
  onText(store, withRole.m);
  await tick();
  assert.match(said(withRole.replies[0]), /Case file/);
});

test('custom prefix', async () => {
  const store = new Store(':memory:');
  onText(store, fake('tz config prefix d', { admin: true }).m);
  await tick();
  assert.equal(store.guild('g1').prefix, 'd');
  assert.equal(onText(store, fake('tz status').m), false);
  assert.equal(onText(store, fake('d status').m), true);
});

test('help for one command', async () => {
  const store = new Store(':memory:');
  const a = fake('tz help setup');
  onText(store, a.m);
  await tick();
  assert.match(said(a.replies[0]), /tz setup/);
  assert.doesNotMatch(said(a.replies[0]), /At your service/);
  const b = fake('tz help hb');
  onText(store, b.m);
  await tick();
  assert.match(said(b.replies[0]), /tz huntbot/);
});

test('reminder panel buttons', async () => {
  const { panel, apply, parseRp } = await import('../src/features/panel.ts');
  const store = new Store(':memory:');
  const view = panel(store, '123456789012345678', 'settings');
  const ids = view.components.flatMap((r) => r.toJSON().components.map((c) => ('custom_id' in c ? c.custom_id : '')));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id.length <= 100));
  assert.equal(store.settings('123456789012345678').pray, true);
  apply(store, '123456789012345678', 'toggle', 'pray', {}, 'c');
  assert.equal(store.settings('123456789012345678').pray, false);
  apply(store, '123456789012345678', 'delivery', '', {}, 'c');
  assert.equal(store.settings('123456789012345678').delivery, 'channel');
  assert.match(apply(store, '123456789012345678', 'quiet', '', { hours: 'nope' }, 'c') ?? '', /format/);
  assert.equal(apply(store, '123456789012345678', 'quiet', '', { hours: '00:30-07:30' }, 'c'), null);
  assert.equal(apply(store, '123456789012345678', 'add', '', { minutes: '30', note: 'restart huntbot' }, 'c'), null);
  const list = store.userReminders('123456789012345678').filter((r) => r.kind === 'custom');
  assert.equal(list.length, 1);
  apply(store, '123456789012345678', 'cancel', String(list[0].id), {}, 'c');
  assert.equal(store.userReminders('123456789012345678').filter((r) => r.kind === 'custom').length, 0);
  assert.deepEqual(parseRp('rp|1|toggle|vote'), { modal: false, userId: '1', action: 'toggle', arg: 'vote' });
});

test('per reminder routes and auto delete', async () => {
  const { apply } = await import('../src/features/panel.ts');
  const store = new Store(':memory:');
  const u = '123456789012345678';
  apply(store, u, 'route', 'pray', {}, 'c');
  assert.equal(store.settings(u).routes.pray, 'channel');
  assert.equal(store.settings(u).routes.huntbot, undefined);
  apply(store, u, 'autodelete', '300', {}, 'c');
  assert.equal(store.settings(u).autodelete, 300);
  apply(store, u, 'autodelete', '7', {}, 'c');
  assert.equal(store.settings(u).autodelete, 300);
  apply(store, u, 'alldm', '', {}, 'c');
  assert.deepEqual(store.settings(u).routes, {});
});

test('grouped commands keep the slash list short and work typed too', async () => {
  assert.ok(definitions.length <= 15, `${definitions.length} top-level slash commands`);
  const owo = definitions.find((d) => d.name === 'owo')!;
  const subs = (owo.options ?? []).map((o) => o.name);
  assert.ok(subs.includes('huntbot') && subs.includes('top'));
  const store = new Store(':memory:');
  const a = fake('tz owo hb');
  assert.equal(onText(store, a.m), true);
  await tick();
  assert.match(said(a.replies[0]), /owo hb/);
});

test('quick typed answers are queued for cleanup, cards are not', async () => {
  const store = new Store(':memory:');
  const sent: string[] = [];
  const a = fake('tz coin');
  (a.m as unknown as { reply: (p: unknown) => Promise<unknown> }).reply = async () => { sent.push('x'); return { id: 'm1', channelId: 'c1' }; };
  onText(store, a.m);
  await tick();
  assert.equal(store.dueDeletes(Date.now() + 31_000).length, 1);
  const b = fake('tz status');
  (b.m as unknown as { reply: (p: unknown) => Promise<unknown> }).reply = async () => ({ id: 'm2', channelId: 'c1' });
  onText(store, b.m);
  await tick();
  assert.equal(store.dueDeletes(Date.now() + 31_000).length, 0);
});
