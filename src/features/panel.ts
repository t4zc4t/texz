import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { Settings, Store } from '../db.js';
import { card } from '../theme.js';

type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;
const row = (...c: MessageActionRowComponentBuilder[]) => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...c);

// reminder types that can each go to DM or a channel
export const routable = ['custom', 'anime', 'owo'] as const;
const names: Record<string, { label: string; emoji: string; about: string }> = {
  custom: { label: 'My own', emoji: '📝', about: 'reminders you set yourself' },
  anime: { label: 'Episode alerts', emoji: '📺', about: 'new episodes of shows you follow' },
  owo: { label: 'OwO pings', emoji: '🔔', about: 'HuntBot back and new OwO day' },
};
const nameOf = (k: string) => names[k] ?? names.custom;

export const autodeleteChoices = [
  { label: 'Keep them', value: 0 },
  { label: 'After 30 seconds', value: 30 },
  { label: 'After 1 minute', value: 60 },
  { label: 'After 5 minutes', value: 300 },
  { label: 'After 15 minutes', value: 900 },
  { label: 'After 1 hour', value: 3600 },
];

const kindLabel: Record<string, string> = { custom: '📝' };
const labelOf = (kind: string, note: string) => (kind.startsWith('ep:') ? `📺 ${note.split('|')[0]} ep ${note.split('|')[1]}` : null);

// custom ids carry the owner and the action, nothing is kept in memory
export const rpId = (userId: string, action: string, arg = '') => `rp|${userId}|${action}|${arg}`;
export const rpmId = (userId: string, what: string) => `rpm|${userId}|${what}`;

export function parseRp(id: string) {
  const [tag, userId, action, arg] = id.split('|');
  return tag === 'rp' || tag === 'rpm' ? { modal: tag === 'rpm', userId, action, arg } : null;
}

function settingsPanel(store: Store, userId: string) {
  const s = store.settings(userId);
  const where = (k: string) => s.routes[k] ?? s.delivery;
  const tag = (k: string) => (where(k) === 'dm' ? '📬 DM' : '📢 channel');
  const del = autodeleteChoices.find((c) => c.value === s.autodelete)?.label ?? `${s.autodelete}s`;
  const embed = card({
    kind: 'settings', title: 'Reminder settings', emoji: '🎛️',
    body: 'Where your reminders land, when I stay quiet, and the time zone I read your times in.',
    fields: [
      { name: '📬 Where they go', value: routable.map((k) => `${nameOf(k).emoji} **${nameOf(k).label}** · ${nameOf(k).about} · ${tag(k)}`).join('\n'), inline: false },
      { name: '🧹 Channel pings', value: del, inline: true },
      { name: '🌙 Quiet hours', value: s.quiet ?? 'off', inline: true },
      { name: '🌏 Time zone', value: s.timezone, inline: true },
    ],
  });
  const routeMenu = new StringSelectMenuBuilder().setCustomId(rpId(userId, 'route')).setPlaceholder('📬 Switch where a reminder lands (DM / channel)')
    .addOptions(routable.map((k) => ({
      label: `${nameOf(k).label}: ${where(k) === 'dm' ? 'DM' : 'channel'} → ${where(k) === 'dm' ? 'channel' : 'DM'}`,
      value: k,
      emoji: nameOf(k).emoji,
    })));
  const deleteMenu = new StringSelectMenuBuilder().setCustomId(rpId(userId, 'autodelete')).setPlaceholder(`🧹 Delete channel pings: ${del}`)
    .addOptions(autodeleteChoices.map((c) => ({ label: c.label, value: String(c.value), default: c.value === s.autodelete })));
  const components: Row[] = [
    row(routeMenu),
    row(deleteMenu),
    row(
      new ButtonBuilder().setCustomId(rpId(userId, 'quiet')).setLabel('Quiet hours').setEmoji('🌙').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(rpId(userId, 'tz')).setLabel('Time zone').setEmoji('🌏').setStyle(ButtonStyle.Primary),
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
      ? list.map((r) => `\`#${r.id}\` ${labelOf(r.kind, r.note) ?? `${kindLabel[r.kind] ?? r.kind}${r.note ? ` ${r.note}` : ''}`} · <t:${Math.floor(r.due_at / 1000)}:R>`).join('\n')
      : 'Nothing queued. A rare quiet moment, enjoy it.',
  });
  const components: Row[] = [];
  if (list.length) {
    components.push(row(new StringSelectMenuBuilder().setCustomId(rpId(userId, 'cancel')).setPlaceholder('🗑️ Cancel a reminder')
      .addOptions(list.slice(0, 25).map((r) => ({
        label: `#${r.id} ${labelOf(r.kind, r.note)?.replace(/^\S+\s/, '') ?? `${(kindLabel[r.kind] ?? r.kind).replace(/^\S+\s/, '')}${r.note ? ` ${r.note}` : ''}`}`.slice(0, 100),
        value: String(r.id),
        description: new Date(r.due_at).toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
      })))));
  }
  components.push(row(
    new ButtonBuilder().setCustomId(rpId(userId, 'add')).setLabel('New reminder').setEmoji('➕').setStyle(ButtonStyle.Success),
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
      .addComponents(input('zone', 'Time zone, like Europe/London or America/New_York', s.timezone, 'Europe/London'));
  }
  if (what === 'add') {
    return new ModalBuilder().setCustomId(rpmId(userId, 'add')).setTitle('New reminder')
      .addComponents(
        input('minutes', 'In how many minutes', '', '30'),
        input('note', 'What should I remind you about', '', 'call mum', TextInputStyle.Paragraph),
      );
  }
  return null;
}

// applies a button press or modal answer, returns an error to show or null when it worked
export function apply(store: Store, userId: string, action: string, arg: string, fields: Record<string, string>, channelId: string): string | null {
  const s = store.settings(userId);
  if (action === 'none') {
  } else if (action === 'delivery') {
    s.delivery = s.delivery === 'dm' ? 'channel' : 'dm';
  } else if (action === 'route' && (routable as readonly string[]).includes(arg)) {
    const now = s.routes[arg] ?? s.delivery;
    s.routes[arg] = now === 'dm' ? 'channel' : 'dm';
  } else if (action === 'alldm' || action === 'allchannel') {
    s.delivery = action === 'alldm' ? 'dm' : 'channel';
    s.routes = {};
  } else if (action === 'autodelete') {
    const v = Number(arg);
    if (autodeleteChoices.some((c) => c.value === v)) s.autodelete = v;
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
  return null;
}
