import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Message } from 'discord.js';
import { Store } from '../src/db.ts';
import { clearCooldowns, onText, definitions } from '../src/core/registry.ts';

beforeEach(() => clearCooldowns());

function fake(content: string, opts: { admin?: boolean; channel?: string; roles?: string[]; cooling?: boolean } = {}) {
  // each fake message is a fresh moment unless the test is about cooldowns
  if (!opts.cooling) clearCooldowns();
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
const said = (r: { content?: string; embeds?: { data: { title?: string; description?: string; fields?: { name: string; value: string }[] } }[] }) =>
  [r.content ?? '', ...(r.embeds ?? []).map((e) => `${e.data.title ?? ''}\n${e.data.description ?? ''}\n${(e.data.fields ?? []).map((f) => `${f.name}\n${f.value}`).join('\n')}`)].join('\n');

test('every slash command has a unique name', () => {
  const names = definitions.map((d) => d.name);
  assert.equal(new Set(names).size, names.length);
});

test('prefix commands and aliases', async () => {
  const store = new Store(':memory:');
  const a = fake('TZ ping');
  assert.equal(onText(store, a.m), true);

  assert.equal(onText(store, fake('tzatziki is great').m), false);
  assert.equal(onText(store, fake('tz nothing').m), false);
  assert.equal(onText(store, fake('hello').m), false);
});

test('features switch off and stay admin only to change', async () => {
  const store = new Store(':memory:');
  const nope = fake('tz config feature anime off');
  onText(store, nope.m);
  await tick();
  assert.match(said(nope.replies[0]), /Manage Server|admin/i);

  const yes = fake('tz config feature utility off', { admin: true });
  onText(store, yes.m);
  await tick();
  assert.equal(store.rules('g1', 'utility').enabled, false);

  const blocked = fake('tz roll');
  onText(store, blocked.m);
  await tick();
  assert.match(said(blocked.replies[0]), /locked here|switched it off|Closed for today/);
});

test('channel and role limits', async () => {
  const store = new Store(':memory:');
  const refused = /<#222222222222222222>|role|select few/;
  onText(store, fake('tz config channel utility add <#222222222222222222>', { admin: true }).m);
  await tick();
  assert.deepEqual(store.rules('g1', 'utility').channels, ['222222222222222222']);

  const wrong = fake('tz roll', { channel: 'c1' });
  onText(store, wrong.m);
  await tick();
  assert.match(said(wrong.replies[0]), /<#222222222222222222>/);

  const right = fake('tz roll', { channel: '222222222222222222' });
  onText(store, right.m);
  await tick();
  assert.doesNotMatch(said(right.replies[0]), refused);

  onText(store, fake('tz config role utility add <@&333333333333333333>', { admin: true }).m);
  await tick();
  const noRole = fake('tz roll', { channel: '222222222222222222' });
  onText(store, noRole.m);
  await tick();
  assert.match(said(noRole.replies[0]), /role|select few/);
  const withRole = fake('tz roll', { channel: '222222222222222222', roles: ['333333333333333333'] });
  onText(store, withRole.m);
  await tick();
  assert.doesNotMatch(said(withRole.replies[0]), refused);
});

test('custom prefix', async () => {
  const store = new Store(':memory:');
  onText(store, fake('tz config prefix d', { admin: true }).m);
  await tick();
  assert.equal(store.guild('g1').prefix, 'd');
  assert.equal(onText(store, fake('tz roll').m), false);
  assert.equal(onText(store, fake('d status').m), true);
});

test('help for one command', async () => {
  const store = new Store(':memory:');
  const a = fake('tz help setup');
  onText(store, a.m);
  await tick();
  assert.match(said(a.replies[0]), /tz setup/);
  assert.doesNotMatch(said(a.replies[0]), /At your service/);
});

test('reminder panel buttons', async () => {
  const { panel, apply, parseRp } = await import('../src/features/panel.ts');
  const store = new Store(':memory:');
  const view = panel(store, '123456789012345678', 'settings');
  const ids = view.components.flatMap((r) => r.toJSON().components.map((c) => ('custom_id' in c ? c.custom_id : '')));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id.length <= 100));
  apply(store, '123456789012345678', 'delivery', '', {}, 'c');
  assert.equal(store.settings('123456789012345678').delivery, 'channel');
  assert.match(apply(store, '123456789012345678', 'quiet', '', { hours: 'nope' }, 'c') ?? '', /format/);
  assert.equal(apply(store, '123456789012345678', 'quiet', '', { hours: '00:30-07:30' }, 'c'), null);
  assert.equal(apply(store, '123456789012345678', 'add', '', { minutes: '30', note: 'stretch' }, 'c'), null);
  const list = store.userReminders('123456789012345678').filter((r) => r.kind === 'custom');
  assert.equal(list.length, 1);
  apply(store, '123456789012345678', 'cancel', String(list[0].id), {}, 'c');
  assert.equal(store.userReminders('123456789012345678').filter((r) => r.kind === 'custom').length, 0);
  assert.deepEqual(parseRp('rp|1|route|custom'), { modal: false, userId: '1', action: 'route', arg: 'custom' });
});

test('per reminder routes and auto delete', async () => {
  const { apply } = await import('../src/features/panel.ts');
  const store = new Store(':memory:');
  const u = '123456789012345678';
  apply(store, u, 'route', 'custom', {}, 'c');
  assert.equal(store.settings(u).routes.custom, 'channel');
  assert.equal(store.settings(u).routes.anime, undefined);
  apply(store, u, 'autodelete', '300', {}, 'c');
  assert.equal(store.settings(u).autodelete, 300);
  apply(store, u, 'autodelete', '7', {}, 'c');
  assert.equal(store.settings(u).autodelete, 300);
  apply(store, u, 'alldm', '', {}, 'c');
  assert.deepEqual(store.settings(u).routes, {});
});

const store0 = () => new Store(':memory:');

test('grouped commands keep the slash list short and work typed too', async () => {
  assert.ok(definitions.length <= 30, `${definitions.length} top-level slash commands`);
  const fun = definitions.find((d) => d.name === 'fun')!;
  assert.ok(fun);
  const dash = fake('tz fun');
  assert.equal(onText(store0(), dash.m), true);
  await tick();
  assert.match(said(dash.replies[0]), /Bar Lupin/);
});

test('quick typed answers are queued for cleanup, cards are not', async () => {
  const store = new Store(':memory:');
  const sent: string[] = [];
  const a = fake('tz afk');
  (a.m as unknown as { reply: (p: unknown) => Promise<unknown> }).reply = async () => { sent.push('x'); return { id: 'm1', channelId: 'c1' }; };
  onText(store, a.m);
  await tick();
  assert.equal(store.dueDeletes(Date.now() + 31_000).length, 1);
  const b = fake('tz fun');
  (b.m as unknown as { reply: (p: unknown) => Promise<unknown> }).reply = async () => ({ id: 'm2', channelId: 'c1' });
  onText(store, b.m);
  await tick();
  assert.equal(store.dueDeletes(Date.now() + 31_000).length, 0);
});

test('commands cool down per person', async () => {
  const store = new Store(':memory:');
  const a = fake('tz coin');
  onText(store, a.m);
  await tick();
  const b = fake('tz coin', { cooling: true });
  onText(store, b.m);
  await tick();
  assert.match(said(b.replies[0]), /give it \*\*\d+s\*\*/);
});

test('typed commands mirror slash paths', async () => {
  const store = new Store(':memory:');
  for (const line of ['tz misc', 'tz profile perks', 'tz fun coin', 'tz anime airing']) {
    const a = fake(line);
    assert.equal(onText(store, a.m), true, line);
    await tick();
  }
});

test('slash commands are valid for discord', () => {
  type O = { name: string; description?: string; type?: number; required?: boolean; choices?: unknown[]; options?: O[] };
  const name = /^[-_\p{Ll}\p{N}]{1,32}$/u;
  const check = (o: O, path: string, depth: number) => {
    const p = `${path} ${o.name}`;
    assert.match(o.name, name, p);
    assert.ok(o.description && o.description.length <= 100, p);
    const opts = o.options ?? [];
    assert.ok(opts.length <= 25, p);
    assert.equal(new Set(opts.map((x) => x.name)).size, opts.length, p);
    const subs = opts.filter((x) => (x.type ?? 0) <= 2);
    assert.ok(!subs.length || subs.length === opts.length, `${p} mixes subcommands and options`);
    let optional = false;
    for (const x of opts) {
      if ((x.type ?? 0) > 2) { if (!x.required) optional = true; else assert.ok(!optional, `${p} ${x.name} required after optional`); }
      assert.ok((x.choices?.length ?? 0) <= 25, p);
      if (x.type === 2) assert.equal(depth, 0, `${p} nested group`);
      check(x, p, depth + ((x.type ?? 0) <= 2 ? 1 : 0));
    }
  };
  for (const d of definitions as unknown as O[]) if ((d.type ?? 1) === 1) check(d, '', 0);
  assert.ok(definitions.length <= 100);
});

test('every group opens a dashboard and every pick can be asked for', async () => {
  const { entriesOf, askModal, needsInput } = await import('../src/core/dashboards.ts');
  const { modules } = await import('../src/core/registry.ts');
  let asked = 0;
  for (const m of modules) for (const c of m.commands) for (const e of entriesOf(c)) {
    if (!needsInput(e)) continue;
    askModal(e, 'u1', 'funhome').toJSON();
    asked++;
  }
  assert.ok(asked > 10);
  const store = new Store(':memory:');
  const a = fake('tz fun');
  onText(store, a.m);
  await tick();
  assert.match(said(a.replies[0]), /Bar Lupin/);
  // old names still land on the new dashboards
  const old = fake('tz games');
  onText(store, old.m);
  await tick();
  assert.match(said(old.replies[0]), /Bar Lupin/);
  const short = fake('tz yen');
  onText(store, short.m);
  await tick();
  assert.match(said(short.replies[0]), /Yen Ledger/);
  const b = fake('tz ship');
  onText(store, b.m);
  await tick();
  assert.match(said(b.replies[0]), /Fill it in|needs a bit more/);
});

test('very short names reach their commands', async () => {
  const store = new Store(':memory:');
  for (const line of ['tz w', 'tz d', 'tz bl', 'tz rk', 'tz ro 2d6', 'tz pi']) {
    const a = fake(line);
    assert.equal(onText(store, a.m), true, line);
    await tick();
  }
});

test('help search, two word names and did you mean', async () => {
  const store = new Store(':memory:');
  const a = fake('tz help money');
  onText(store, a.m);
  await tick();
  assert.match(said(a.replies[0]), /tz wallet/);
  const b = fake('tz help ping me');
  onText(store, b.m);
  await tick();
  assert.match(said(b.replies[0]), /tz pings/);
  const c = fake('tz rnak');
  assert.equal(onText(store, c.m), true);
  await tick();
  assert.match(said(c.replies[0]), /Did you mean \*\*`tz rank`/);
  const d = fake('tz help xp');
  onText(store, d.m);
  await tick();
  assert.doesNotMatch(said(d.replies[0]), /Give xp/);
  const e = fake('tz help quiz crest');
  onText(store, e.m);
  await tick();
  assert.match(said(e.replies[0]), /tz quiz crest/);
});
