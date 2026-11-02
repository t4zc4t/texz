import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { Settings, Store } from '../db.js';
import { scheduleDailies } from '../reminders.js';
import { card } from '../theme.js';

type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;
const row = (...c: MessageActionRowComponentBuilder[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...c);

export const toggles = ['huntbot', 'pray', 'vote', 'daily', 'minigames', 'lastcall', 'huntbattle'] as const;
export type Toggle = (typeof toggles)[number];

const names: Record<Toggle, { label: string; emoji: string; about: string }> = {
  huntbot: { label: 'Huntbot', emoji: '🤖', about: 'when your huntbot comes home' },
  pray: { label: 'Pray', emoji: '🙏', about: 'when pray and curse are ready' },
  vote: { label: 'Vote', emoji: '🗳️', about: '12 hours after you vote' },
  daily: { label: 'New day', emoji: '🌅', about: 'the list when OwO resets' },
  minigames: { label: 'Minigames', emoji: '🦀', about: 'alastor, piku, run and friends on the list' },
  lastcall: { label: 'Last call', emoji: '⏳', about: 'two hours before reset, if anything is open' },
  huntbattle: { label: 'Hunt 15s', emoji: '🏹', about: 'every hunt and battle cooldown (noisy)' },
};

const kindLabel: Record<string, string> = {
  huntbot: '🤖 huntbot home', pray: '🙏 pray ready', vote: '🗳️ vote open', hunt: '🏹 hunt ready',
  reset: '🌅 new OwO day', lastcall: '⏳ last call', custom: '📝',
};

// custom ids carry the owner and the action, nothing is kept in memory
export const rpId = (userId: string, action: string, arg = '') => `rp|${userId}|${action}|${arg}`;
export const rpmId = (userId: string, what: string) => `rpm|${userId}|${what}`;

export function parseRp(id: string) {
  const [tag, userId, action, arg] = id.split('|');
  return tag === 'rp' || tag === 'rpm' ? { modal: tag === 'rpm', userId, action, arg } : null;
}

function settingsPanel(store: Store, userId: string) {
  const s = store.settings(userId);
  const embed = card({
    kind: 'settings', title: 'Reminder control room', emoji: '🎛️',
    body: 'Press a button to switch a reminder on or off. Green means I\'ll ping you.',
    fields: [
      { name: '🔔 Reminders', value: toggles.map((t) => `${s[t] ? '🟢' : '⚫'} ${names[t].emoji} **${names[t].label}** · ${names[t].about}`).join('\n'), inline: false },
      { name: '📬 Delivery', value: s.delivery === 'dm' ? 'DM' : 'ping in channel', inline: true },
      { name: '🌙 Quiet hours', value: s.quiet ?? 'off', inline: true },
      { name: '🌏 Timezone', value: s.timezone, inline: true },
    ],
  });
  const btn = (t: Toggle) => new ButtonBuilder().setCustomId(rpId(userId, 'toggle', t)).setLabel(names[t].label).setEmoji(names[t].emoji)
    .setStyle(s[t] ? ButtonStyle.Success : ButtonStyle.Secondary);
  const components: Row[] = [
    row(...toggles.slice(0, 4).map(btn)),
    row(...toggles.slice(4).map(btn)),
    row(
      new ButtonBuilder().setCustomId(rpId(userId, 'delivery')).setLabel(s.delivery === 'dm' ? 'DM' : 'Channel').setEmoji(s.delivery === 'dm' ? '📬' : '📢').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(rpId(userId, 'quiet')).setLabel('Quiet hours').setEmoji('🌙').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(rpId(userId, 'tz')).setLabel('Timezone').setEmoji('🌏').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(rpId(userId, 'view', 'list')).setLabel('My reminders').setEmoji('📝').setStyle(ButtonStyle.Secondary),
    ),
  ];
  return { embeds: [embed], components };
}

function listPanel(store: Store, userId: string) {
  const list = store.userReminders(userId);
  const embed = card({
    kind: 'remindAdd', title: 'Promises I made', emoji: '📝',
    body: list.length
      ? list.map((r) => `\`#${r.id}\` ${kindLabel[r.kind] ?? r.kind}${r.note ? ` ${r.note}` : ''} · <t:${Math.floor(r.due_at / 1000)}:R>`).join('\n')
      : 'Nothing queued. A rare quiet moment, enjoy it.',
  });
  const components: Row[] = [];
  if (list.length) {
    components.push(row(new StringSelectMenuBuilder().setCustomId(rpId(userId, 'cancel')).setPlaceholder('🗑️ Cancel a reminder')
      .addOptions(list.slice(0, 25).map((r) => ({
        label: `#${r.id} ${(kindLabel[r.kind] ?? r.kind).replace(/^\S+\s/, '')}${r.note ? ` ${r.note}` : ''}`.slice(0, 100),
        value: String(r.id),
        description: new Date(r.due_at).toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
      })))));
  }
  components.push(row(
    new ButtonBuilder().setCustomId(rpId(userId, 'add')).setLabel('New reminder').setEmoji('➕').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(rpId(userId, 'view', 'list')).setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(rpId(userId, 'view', 'settings')).setLabel('Settings').setEmoji('🎛️').setStyle(ButtonStyle.Primary),
  ));
  return { embeds: [embed], components };
}

export function panel(store: Store, userId: string, view: 'settings' | 'list') {
  return view === 'list' ? listPanel(store, userId) : settingsPanel(store, userId);
}

export function modalFor(userId: string, what: string, s: Settings): ModalBuilder | null {
  const input = (id: string, label: string, value: string, placeholder: string, style = TextInputStyle.Short, required = true) =>
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style)
      .setPlaceholder(placeholder).setRequired(required).setValue(value));
  if (what === 'quiet') {
    return new ModalBuilder().setCustomId(rpmId(userId, 'quiet')).setTitle('Quiet hours')
      .addComponents(input('hours', 'From-to in your time, or "off"', s.quiet ?? '', '00:30-07:30'));
  }
  if (what === 'tz') {
    return new ModalBuilder().setCustomId(rpmId(userId, 'tz')).setTitle('Your timezone')
      .addComponents(input('zone', 'Timezone name', s.timezone, 'Asia/Kolkata'));
  }
  if (what === 'add') {
    return new ModalBuilder().setCustomId(rpmId(userId, 'add')).setTitle('New reminder')
      .addComponents(
        input('minutes', 'In how many minutes', '', '30'),
        input('note', 'What should I remind you about', '', 'restart the huntbot', TextInputStyle.Paragraph),
      );
  }
  return null;
}

// applies a button press or modal answer, returns an error to show or null when it worked
export function apply(store: Store, userId: string, action: string, arg: string, fields: Record<string, string>, channelId: string): string | null {
  const s = store.settings(userId);
  if (action === 'toggle' && (toggles as readonly string[]).includes(arg)) {
    const t = arg as Toggle;
    s[t] = !s[t];
    if (!s[t]) for (const r of store.userReminders(userId)) {
      if (r.kind === t || (t === 'daily' && r.kind === 'reset') || (t === 'huntbattle' && r.kind === 'hunt')) store.deleteReminder(r.id);
    }
  } else if (action === 'delivery') {
    s.delivery = s.delivery === 'dm' ? 'channel' : 'dm';
  } else if (action === 'quiet') {
    const h = (fields.hours ?? '').trim().toLowerCase();
    if (h === 'off' || h === '') s.quiet = null;
    else if (/^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(h)) s.quiet = h;
    else return 'Use the format 00:30-07:30, or "off".';
  } else if (action === 'tz') {
    const zone = (fields.zone ?? '').trim();
    try { new Intl.DateTimeFormat('en', { timeZone: zone }); } catch { return 'That timezone isn\'t real, use one like Asia/Kolkata.'; }
    s.timezone = zone;
  } else if (action === 'add') {
    const mins = Number.parseInt(fields.minutes ?? '', 10);
    const note = (fields.note ?? '').trim();
    if (!mins || mins < 1 || mins > 10080) return 'Minutes has to be between 1 and 10080 (a week).';
    if (!note) return 'Tell me what to remind you about.';
    store.addReminder(userId, 'custom', new Date(Date.now() + mins * 60_000), note.slice(0, 200), channelId);
    return null;
  } else if (action === 'cancel') {
    store.deleteReminder(Number(arg), userId);
    return null;
  }
  store.saveSettings(userId, s);
  scheduleDailies(store, userId);
  return null;
}
