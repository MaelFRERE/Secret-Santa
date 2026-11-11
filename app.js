'use strict';
const $ = id => document.getElementById(id);
const tokenKey = 'secret-santa-token';
const pendingKey = 'secret-santa-pending-registration';
const isFile = location.protocol === 'file:';
const getSaved = key => { try { return localStorage.getItem(key); } catch { return null; } };
let token = new URL(location.href).searchParams.get('t') || getSaved(tokenKey);
let pendingRegistration = getSaved(pendingKey);
if (pendingRegistration && !/^[a-f0-9]{48}$/.test(pendingRegistration)) pendingRegistration = null;
let profile = null;
let state = null;
let sessionInvalid = false;
let recoverOpen = false;
let busy = false;
let refreshing = false;
let revision = 0;
let pushEnabled = false;
let pushAutoPending = false;
let pushCheckingToken = null;
let adminCode = null; // Volontairement en mémoire uniquement, pas dans localStorage.
let adminState = null;
let adminBusy = false;
let adminEditing = null;

function createSnowfall(){
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const host = $('snowfall');
  const icons = ['❄', '·', '✦'];
  const total = window.innerWidth <= 600 ? 15 : 24;
  for(let i = 0; i < total; i++){
    const el = document.createElement('span');
    el.className = 'flake';
    el.textContent = icons[Math.floor(Math.random() * icons.length)];
    el.style.left = Math.round(Math.random() * 100) + 'vw';
    el.style.fontSize = (10 + Math.round(Math.random() * 9)) + 'px';
    el.style.animationDuration = (10 + Math.round(Math.random() * 12)) + 's';
    el.style.animationDelay = (-Math.random() * 22) + 's';
    el.style.setProperty('--drift', Math.round(-35 + Math.random() * 70) + 'px');
    host.appendChild(el);
  }
}
createSnowfall();
function secretForRegistration(){
  if (!pendingRegistration){
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    pendingRegistration = [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem(pendingKey, pendingRegistration); } catch {}
  }
  return pendingRegistration;
}
function clearPending(){
  pendingRegistration = null;
  try { localStorage.removeItem(pendingKey); } catch {}
}
function updateManifestHref(){
  const manifest = document.querySelector('link[rel="manifest"]');
  if (!manifest) return;
  manifest.href = token && /^[a-f0-9]{48}$/.test(token)
    ? '/manifest.webmanifest?t=' + encodeURIComponent(token)
    : '/manifest.webmanifest';
}
updateManifestHref();
function storeToken(next){
  token = next || null;
  updateManifestHref();
  revision++;
  pushEnabled = false;
  pushCheckingToken = null;
  try {
    if (token) localStorage.setItem(tokenKey, token);
    else localStorage.removeItem(tokenKey);
  } catch {}
  if (!isFile){
    const url = new URL(location.href);
    if (token) url.searchParams.set('t', token);
    else url.searchParams.delete('t');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
}
function showText(id, value, success = false){
  $(id).textContent = value;
  $(id).hidden = !value;
  $(id).classList.toggle('ok', success);
}
async function api(path, data, extraHeaders = {}){
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 22000);
  try{
    const response = await fetch(path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: {'Content-Type':'application/json', ...extraHeaders},
      body: data === undefined ? undefined : JSON.stringify(data),
      signal:controller.signal,cache:'no-store'
    });
    let parsed;
    try { parsed = await response.json(); }
    catch { throw Error('Le serveur se réveille ou est temporairement indisponible. Réessaie dans un instant.'); }
    if (!response.ok){
      const error = new Error(parsed.error || 'Une erreur est survenue.');
      error.status = response.status;
      throw error;
    }
    return parsed;
  } catch(error){
    if (error.name === 'AbortError') throw Error('Le serveur met du temps à répondre. Réessaie dans un instant.');
    if (error instanceof TypeError) throw Error('Connexion indisponible. Ton inscription reste conservée.');
    throw error;
  } finally { clearTimeout(timeout); }
}
function render(){
  const known = Boolean(token && profile);
  const pending = Boolean(token && !profile && !sessionInvalid);
  const closed = Boolean(state?.drawn);
  $('joinOpen').hidden = known || pending || sessionInvalid || closed || recoverOpen;
  $('joinSuccess').hidden = !known;
  $('joinChecking').hidden = !pending;
  $('joinInvalid').hidden = !sessionInvalid || recoverOpen;
  $('joinClosed').hidden = known || pending || sessionInvalid || !closed || recoverOpen;
  $('recoverEntry').hidden = known || pending || recoverOpen;
  $('recoverBox').hidden = known || pending || !recoverOpen;
  $('recoverToggle').disabled = busy;
  $('recoverToggle').setAttribute('aria-expanded', String(recoverOpen));
  $('recoverButton').disabled = busy || !state || isFile;
  $('recoverButton').textContent = busy ? 'Recherche en cours…' : 'Retrouver mon espace';
  $('resetSession').hidden = closed;
  $('joinButton').disabled = !state || closed || busy || isFile;
  $('joinButton').textContent = busy ? 'Inscription en cours…' : !state ? 'Connexion en cours…' : 'Je participe !';
  $('personal').hidden = !known;
  if (known){
    const result = $('result');
    result.classList.toggle('complete', Boolean(profile.drawn));
    result.textContent = profile.drawn ? `Tu offres un cadeau à ${profile.recipient} !` : 'Le tirage n’a pas encore eu lieu.';
  }
  if (state){
    $('countBadge').textContent = state.drawn ? 'Tirage effectué' :
      `${state.count} ${state.count > 1 ? 'inscrits' : 'inscrit'}`;
  }
  // Aucun bloc superflu si l'alerte est deja active ou refusee.
  $('pushPanel').hidden = !known || closed || pushEnabled || pushAutoPending ||
    ('Notification' in window && Notification.permission === 'denied');
  renderPush();
}
function isIOS(){
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function isStandalone(){
  return Boolean(navigator.standalone) || matchMedia('(display-mode: standalone)').matches;
}
function pushSupportMessage(){
  if (isIOS() && !isStandalone()) return 'Sur iPhone : ouvre le site dans Safari, puis Partager → Sur l’écran d’accueil. Ouvre ensuite l’icône ajoutée et active les notifications.';
  if (!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)){
    return 'Les notifications ne sont pas disponibles sur ce navigateur. Ton résultat restera accessible ici.';
  }
  if (Notification.permission === 'denied') return 'Notifications bloquées. Autorise-les dans les réglages du navigateur pour les activer.';
  return '';
}
function renderPush(){
  const btn = $('enablePush');
  btn.disabled = pushEnabled || busy || pushAutoPending;
  btn.textContent = pushEnabled ? '✓ Notifications activées' : '🔔 Activer les alertes';
}
// Doit etre appele directement pendant le clic sur "Je participe !".
// Les navigateurs refusent les demandes de permission declenchees apres un fetch.
function promptPushDuringSignup(){
  if (pushSupportMessage() || Notification.permission === 'denied') return null;
  if (Notification.permission === 'granted') return Promise.resolve('granted');
  try {
    return Promise.resolve(Notification.requestPermission()).catch(() => 'default');
  } catch {
    return Promise.resolve('default');
  }
}
async function registerPushForCurrentParticipant(permissionPromise, showFeedback = false){
  const currentToken = token;
  if (!currentToken || !profile || state?.drawn) return;
  pushAutoPending = true;
  render();
  try {
    const permission = await permissionPromise;
    if (permission !== 'granted') return;
    const reg = await navigator.serviceWorker.register('/sw.js', {scope: '/'});
    await navigator.serviceWorker.ready;
    const {publicKey} = await api('/api/push/config');
    const bytes = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const current = await reg.pushManager.getSubscription();
    const sub = current || await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:bytes});
    // Ne pas inscrire un autre utilisateur si la session a change entre-temps.
    if (currentToken !== token || !profile || state?.drawn) return;
    await api('/api/push/subscribe', {token:currentToken, subscription:sub.toJSON()});
    if (currentToken !== token) return;
    pushEnabled = true;
    pushCheckingToken = currentToken;
    if (showFeedback) showText('pushStatus', 'Alerte active pour le tirage.', true);
  } catch(error){
    if (showFeedback) showText('pushStatus', error.message || 'Activation impossible. Tu peux reessayer.');
  } finally {
    pushAutoPending = false;
    render();
  }
}
async function syncExistingPush(){
  if (!token || !profile || !state || state.drawn || pushCheckingToken === token || pushAutoPending) return;
  if (pushSupportMessage() || Notification.permission !== 'granted') return;
  const currentToken = token;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    if (currentToken !== token) return;
    await api('/api/push/subscribe', {token:currentToken, subscription:sub.toJSON()});
    if (currentToken !== token) return;
    pushEnabled = true;
    pushCheckingToken = currentToken;
    render();
  } catch {
    // La prochaine actualisation pourra reessayer apres une indisponibilite.
  }
}
$('enablePush').addEventListener('click', () => {
  if (!token || !profile || !state || state.drawn || busy || pushEnabled || pushAutoPending) return;
  const unsupported = pushSupportMessage();
  if (unsupported){ showText('pushStatus', unsupported); return; }
  // La permission doit etre demandee pendant ce geste, avant tout await.
  const permission = promptPushDuringSignup();
  if (permission) void registerPushForCurrentParticipant(permission, true);
});

async function refresh(){
  if (isFile || refreshing || busy) return;
  refreshing = true;
  const currentRevision = revision;
  const currentToken = token;
  try {
    const fresh = await api('/api/state');
    if (revision !== currentRevision) return;
    if (!Number.isInteger(fresh.count) || typeof fresh.drawn !== 'boolean') throw Error('Réponse du serveur incorrecte.');
    const previouslyDrawn = state?.drawn;
    state = fresh;
    if (!currentToken && pendingRegistration){
      try {
        const recovered = await api('/api/result', {token: pendingRegistration});
        if (currentRevision !== revision) return;
        storeToken(pendingRegistration);
        profile = recovered;
        sessionInvalid = false;
        clearPending();
      } catch(error){
        if (error.status !== 403) throw error;
      }
    }
    if (currentToken){
      try {
        const found = await api('/api/result', {token: currentToken});
        if (currentRevision !== revision) return;
        profile = found;
        sessionInvalid = false;
        try { localStorage.setItem(tokenKey, currentToken); } catch {}
      } catch(error){
        if (currentRevision !== revision) return;
        if (error.status === 403){ sessionInvalid = true; profile = null; }
        else throw error;
      }
    }
    showText('connectionMsg', '');
    if (previouslyDrawn === false && fresh.drawn && profile?.drawn){
      $('drawAnnouncement').hidden = false;
      setTimeout(() => { $('drawAnnouncement').hidden = true; }, 11000);
    }
    if (profile && token) void syncExistingPush();
  } catch(error){
    if (revision === currentRevision) showText('connectionMsg', error.message);
  } finally { refreshing = false; render(); }
}
$('joinForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!state || state.drawn || busy || token || isFile) return;
  const firstName = $('firstName').value.trim();
  const lastName = $('lastName').value.trim();
  if (firstName.length < 2 || !lastName){ showText('joinMsg', 'Indique ton prénom et ton nom.'); return; }
  // Propose immediatement l'alerte dans le geste de soumission (avant le fetch).
  // Le refus ne bloque jamais l'inscription ni l'acces au tirage.
  const permissionPromise = promptPushDuringSignup();
  busy = true;
  revision++;
  showText('joinMsg', '');
  render();
  try {
    const result = await api('/api/join', {firstName, lastName, registrationToken:secretForRegistration()});
    storeToken(result.token);
    clearPending();
    sessionInvalid = false;
    profile = result;
    recoverOpen = false;
    showText('connectionMsg', '');
    if (permissionPromise) void registerPushForCurrentParticipant(permissionPromise);
    if (isIOS() && !isStandalone()) {
      // Recharger avec le manifeste personnalisé garantit que l'icône iOS
      // rouvre la bonne inscription malgré son stockage séparé.
      location.reload();
      return;
    }
  } catch(error){ showText('joinMsg', error.status === 409 && error.message.includes('déjà inscrite') ? 'Cette personne est déjà inscrite. Utilise « Déjà inscrit ? » ci-dessous.' : error.message); }
  finally { busy = false; render(); await refresh(); }
});
$('recoverToggle').addEventListener('click', () => {
  recoverOpen = true;
  showText('recoverMsg', '');
  render();
  $('recoverFirstName').focus();
});
$('recoverCancel').addEventListener('click', () => {
  recoverOpen = false;
  showText('recoverMsg', '');
  render();
});
$('recoverForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !state || profile || isFile) return;
  const firstName = $('recoverFirstName').value.trim();
  const lastName = $('recoverLastName').value.trim();
  if (firstName.length < 2 || !lastName) {
    showText('recoverMsg', 'Saisis ton prénom et ton nom.');
    return;
  }
  // La permission doit être demandée avant le réseau, durant le clic.
  // Refuser la notification ne bloque pas la récupération du compte.
  const permissionPromise = promptPushDuringSignup();
  busy = true;
  revision++;
  showText('recoverMsg', '');
  render();
  try {
    const found = await api('/api/recover', {firstName, lastName});
    storeToken(found.token);
    clearPending();
    sessionInvalid = false;
    recoverOpen = false;
    profile = found;
    $('recoverForm').reset();
    showText('connectionMsg', '');
    if (permissionPromise) void registerPushForCurrentParticipant(permissionPromise);
    if (isIOS() && !isStandalone()) {
      // Permet d'installer la PWA iOS avec la clé de session récupérée.
      location.reload();
      return;
    }
  } catch(error){ showText('recoverMsg', error.message); }
  finally { busy = false; render(); await refresh(); }
});
$('resetSession').addEventListener('click', () => {
  if (state?.drawn) return;
  storeToken(null);
  sessionInvalid = false;
  profile = null;
  clearPending();
  $('joinForm').reset();
  showText('joinMsg', '');
  render();
  $('firstName').focus();
});

function element(tag, className, text){
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function adminHeaders(){ return {'x-admin-code':adminCode}; }
async function adminApi(path, data = {}){ return api(path, data, adminHeaders()); }
function renderAdmin(){
  $('adminLocked').hidden = Boolean(adminCode && adminState);
  $('adminDashboard').hidden = !adminCode || !adminState;
  if (!adminState) return;
  const p = adminState.participants;
  const devices = p.reduce((n, person) => n + person.pushDevices, 0);
  const pushed = p.reduce((n, person) => n + person.pushAccepted, 0);
  $('adminCounts').textContent = `${p.length} participant${p.length > 1 ? 's' : ''} · ${devices} appareil${devices > 1 ? 's' : ''} avec alertes`;
  $('adminList').replaceChildren();
  if (!p.length) $('adminList').appendChild(element('p','empty-participants','Aucun participant pour le moment.'));
  for (const person of p){
    const row = element('div','participant-row');
    const editing = adminEditing === person.id && !adminState.drawn;
    if (editing){
      const form = element('form','participant-form');
      const first = element('div','field');
      const firstLabel = element('label',null,'Prénom');
      const firstInput = element('input');
      firstInput.type = 'text'; firstInput.name = 'firstName'; firstInput.required = true;
      firstInput.minLength = 2; firstInput.maxLength = 40; firstInput.value = person.firstName || '';
      firstLabel.htmlFor = 'edit-first-' + person.id; firstInput.id = firstLabel.htmlFor;
      first.append(firstLabel, firstInput);
      const last = element('div','field');
      const lastLabel = element('label',null,'Nom');
      const lastInput = element('input');
      lastInput.type = 'text'; lastInput.name = 'lastName'; lastInput.required = true;
      lastInput.minLength = 1; lastInput.maxLength = 40; lastInput.value = person.lastName || '';
      lastLabel.htmlFor = 'edit-last-' + person.id; lastInput.id = lastLabel.htmlFor;
      last.append(lastLabel, lastInput);
      const actions = element('div','participant-form-actions');
      const save = element('button','mini-button','Enregistrer'); save.type = 'submit';
      const cancel = element('button','mini-button','Annuler'); cancel.type = 'button';
      cancel.addEventListener('click', () => {adminEditing = null; renderAdmin();});
      actions.append(save, cancel);
      form.append(first, last, actions);
      form.addEventListener('submit', async event => {
        event.preventDefault();
        await adminAction('/api/admin/update', {id: person.id, firstName:firstInput.value, lastName:lastInput.value}, 'Participant modifié.');
      });
      row.appendChild(form);
    } else {
      const line = element('div','participant-main');
      const info = element('div','participant-info');
      info.appendChild(element('div','participant-name',person.name));
      if (person.pushDevices) info.appendChild(element('div','participant-push',adminState.drawn
        ? `${person.pushAccepted}/${person.pushDevices} alerte(s) acceptée(s)`
        : `🔔 ${person.pushDevices} appareil${person.pushDevices > 1 ? 's' : ''}`));
      line.appendChild(info);
      if (!adminState.drawn){
        const actions = element('div','participant-actions');
        const edit = element('button','mini-button','Modifier'); edit.type = 'button';
        edit.setAttribute('aria-label', 'Modifier ' + person.name);
        edit.addEventListener('click', () => {adminEditing = person.id;renderAdmin();});
        const remove = element('button','mini-button danger','Supprimer');remove.type='button';
        remove.setAttribute('aria-label', 'Supprimer ' + person.name);
        remove.addEventListener('click', async () => {
          if (!confirm(`Supprimer ${person.name} de la liste ? Cette personne ne participera plus au tirage.`)) return;
          await adminAction('/api/admin/delete', {id:person.id}, 'Participant supprimé.');
        });
        actions.append(edit,remove);line.appendChild(actions);
      }
      row.appendChild(line);
    }
    $('adminList').appendChild(row);
  }
  $('adminDraw').disabled = adminBusy || adminState.drawn || p.length < 2;
  $('adminResetDraw').hidden = !adminState.drawn;
  $('adminResetDraw').disabled = adminBusy;
  $('adminResetAll').disabled = adminBusy || (!adminState.drawn && !p.length);
  $('adminDraw').textContent = adminState.drawn ? 'Tirage déjà effectué ✓' : 'Lancer le tirage au sort';
  $('drawExplanation').textContent = adminState.drawn
    ? `Résultats disponibles dans les espaces personnels. ${pushed} alerte${pushed > 1 ? 's' : ''} acceptée${pushed > 1 ? 's' : ''} par les services de notification.`
    : 'Vérifie les noms avant de lancer le tirage.';
}
async function adminAction(path, payload, success){
  if (adminBusy || !adminCode) return;
  adminBusy = true;
  showText('adminMsg', '');
  try {
    adminState = await adminApi(path, payload);
    adminEditing = null;
    showText('adminMsg', success, true);
    state = {count:adminState.participants.length, drawn:adminState.drawn, storage:adminState.storage};
    render();
  } catch(error){
    showText('adminMsg', error.message);
    if (error.status === 403) logoutAdmin();
  } finally { adminBusy = false; renderAdmin(); }
}
async function loadAdmin(){
  if (!adminCode || adminBusy || adminEditing) return;
  adminBusy = true;
  try {
    adminState = await adminApi('/api/admin/list');
    showText('adminLoginMsg', '');
  } catch(error){
    if (error.status === 403){
      adminCode = null; adminState = null;
      showText('adminLoginMsg', 'Code incorrect. Réessaie.');
    } else if (!adminState) showText('adminLoginMsg', error.message);
    else showText('adminMsg', error.message);
  } finally {adminBusy = false;renderAdmin();}
}
$('adminLoginForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (adminBusy) return;
  adminCode = $('adminCode').value;
  $('adminCode').value = '';
  await loadAdmin();
});
function logoutAdmin(){
  adminCode = null; adminState = null; adminEditing = null;
  renderAdmin();
}
$('adminLogout').addEventListener('click', logoutAdmin);
$('adminDraw').addEventListener('click', async () => {
  if (!adminCode || !adminState || adminState.drawn || adminState.participants.length < 2 || adminBusy) return;
  if (!confirm(`Lancer DÉFINITIVEMENT le tirage pour ${adminState.participants.length} participants ? Les inscriptions et modifications seront fermées, et les notifications seront envoyées aux personnes qui les ont activées.`)) return;
  adminBusy = true;
  renderAdmin();
  try {
    const result = await adminApi('/api/draw');
    showText('adminMsg', result.notificationDevices
      ? `Tirage effectué ! Envoi des alertes lancé pour ${result.notificationDevices} appareil(s).`
      : 'Tirage effectué ! Personne n’avait activé les notifications.', true);
    adminState = await adminApi('/api/admin/list');
    state = {count:adminState.participants.length, drawn:true, storage:adminState.storage};
    if (profile && token) await refresh();
    else render();
  } catch(error){showText('adminMsg', error.message);}
  finally {adminBusy = false;renderAdmin();await refresh();}
});
async function resetSecretSanta(mode){
  if (!adminCode || !adminState || adminBusy) return;
  const isAll = mode === 'all';
  const phrase = isAll ? 'TOUT SUPPRIMER' : 'REFAIRE LE TIRAGE';
  const question = isAll
    ? `Cette opération supprimera définitivement les ${adminState.participants.length} participants ET le tirage dans Neon. Leurs espaces personnels ne fonctionneront plus.\n\nPour confirmer, écris : ${phrase}`
    : `Annuler le tirage actuel ? Les ${adminState.participants.length} inscriptions resteront enregistrées et tu pourras relancer le tirage. Les résultats précédents seront perdus.\n\nPour confirmer, écris : ${phrase}`;
  if (prompt(question) !== phrase) return;
  adminBusy = true;
  renderAdmin();
  showText('adminMsg', '');
  try {
    adminState = await adminApi('/api/admin/reset', {mode, confirmation:phrase});
    adminEditing = null;
    state = {count:adminState.participants.length, drawn:false, storage:adminState.storage};
    showText('adminMsg', isAll
      ? 'Secret Santa remis à zéro. Toutes les inscriptions ont été supprimées.'
      : 'Tirage annulé. Les participants sont conservés : tu peux modifier la liste et relancer le tirage.', true);
    if (isAll){
      storeToken(null);
      profile = null;
      sessionInvalid = false;
      clearPending();
      $('joinForm').reset();
    }
    render();
    await refresh();
  } catch(error){
    showText('adminMsg', error.message);
    if (error.status === 403) logoutAdmin();
  } finally {adminBusy = false; renderAdmin();}
}
$('adminResetDraw').addEventListener('click', () => void resetSecretSanta('draw'));
$('adminResetAll').addEventListener('click', () => void resetSecretSanta('all'));
$('adminDetails').addEventListener('toggle', () => {
  if ($('adminDetails').open && adminCode) void loadAdmin();
});
if (isFile) showText('connectionMsg', 'Aperçu uniquement : ouvre l’application depuis Render pour enregistrer les inscriptions.');
render();
renderAdmin();
void refresh();
setInterval(() => {if (!document.hidden) {void refresh(); if ($('adminDetails').open && adminCode) void loadAdmin();}}, 12000);
window.addEventListener('online', () => {void refresh();});
document.addEventListener('visibilitychange', () => {if (!document.hidden) {void refresh();if ($('adminDetails').open && adminCode) void loadAdmin();}});
