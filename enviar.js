/* ============================================================
   Carteiro de avisos — Nossa Agenda
   Roda no GitHub Actions de tempos em tempos. Lê os compromissos
   de Trabalho no Firebase e envia notificações push (7, 3, 2, 1
   dia e 1 hora antes), mesmo com o app do casal fechado.
   ============================================================ */
const admin = require('firebase-admin');
const webpush = require('web-push');

const sa = JSON.parse(process.env.FIREBASE_SA);
admin.initializeApp({
  credential: admin.credential.cert(sa),
  databaseURL: 'https://nossa-agenda-70da2-default-rtdb.firebaseio.com'
});
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:ferrenorte2017@gmail.com',
  process.env.VAPID_PUBLIC,
  process.env.VAPID_PRIVATE
);

const db = admin.database();
const TZ = -3;                       // Brasil (sem horário de verão)
const OFF = [                        // antecedências, em minutos
  { m: 7 * 1440, l: 'faltam 7 dias' },
  { m: 3 * 1440, l: 'faltam 3 dias' },
  { m: 2 * 1440, l: 'faltam 2 dias' },
  { m: 1 * 1440, l: 'falta 1 dia' },
  { m: 60,       l: 'falta 1 hora' },
];

// data local (YYYY-MM-DD) + hora (HH:MM) -> instante em UTC (ms)
function eventoUTC(dateKey, hhmm) {
  const [y, mo, d] = dateKey.split('-').map(Number);
  const [h, mi] = (hhmm || '08:00').split(':').map(Number);
  return Date.UTC(y, mo - 1, d, h - TZ, mi);   // UTC = local - (offset negativo) = local + 3
}
function diaMais(dateKey, n) {
  const t = new Date(dateKey + 'T00:00:00Z').getTime() + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

(async () => {
  const now = Date.now();
  const snap = await db.ref('casais').get();
  const all = snap.val() || {};
  let enviados = 0;

  for (const code of Object.keys(all)) {
    const c = all[code] || {};
    const agenda = c.agenda || {};
    const subs = c.push || {};
    const sent = c.sent || {};
    const subList = Object.entries(subs);          // [deviceId, {sub, perfil, ...}]
    if (!subList.length) continue;

    for (const wk of Object.keys(agenda)) {
      const days = agenda[wk] || {};
      for (const di of Object.keys(days)) {
        const blocks = days[di] || [];
        for (const b of blocks) {
          if (!b || b.cat !== 'trabalho') continue;
          const evDateKey = diaMais(wk, Number(di));
          const evUTC = eventoUTC(evDateKey, b.time);
          if (now >= evUTC) continue;              // evento já passou

          for (const off of OFF) {
            const remTime = evUTC - off.m * 60000;
            const key = (b.id || (evDateKey + b.time)) + '_' + off.m;
            if (sent[key]) continue;
            if (now < remTime) continue;           // ainda não chegou a hora do aviso

            const title = '⏰ Trabalho: ' + (b.title || 'compromisso');
            const body = off.l + ' • ' + evDateKey.split('-').reverse().join('/') +
                         ' às ' + (b.time || '') + (b.timeEnd ? '–' + b.timeEnd : '');
            const payload = JSON.stringify({ title, body, tag: key });

            for (const [devId, info] of subList) {
              if (!info || !info.sub) continue;
              if (b.who && b.who !== 'ambos' && info.perfil && info.perfil !== b.who) continue;
              try {
                await webpush.sendNotification(info.sub, payload);
                enviados++;
              } catch (e) {
                if (e.statusCode === 404 || e.statusCode === 410) {
                  await db.ref(`casais/${code}/push/${devId}`).remove(); // inscrição morta
                } else {
                  console.warn('falha envio', code, e.statusCode || e.message);
                }
              }
            }
            await db.ref(`casais/${code}/sent/${key}`).set(now);
          }
        }
      }
    }
  }
  console.log(new Date().toISOString(), 'avisos enviados:', enviados);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
