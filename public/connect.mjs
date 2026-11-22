import { sealFile, MAX_FILE_BYTES } from './app-core.mjs';
import { encodeSignal, decodeSignal, TransferReceiver, sendPackage } from './peer-protocol.mjs';

const $ = id => document.getElementById(id);
let connection = null;
let channel = null;
let role = null;
let sending = false;
let pendingSha = null;
let incomingBytes = null;
let inbox = new TransferReceiver();
let receiveQueue = Promise.resolve();
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

function status(message, problem = false) {
  $('peer-status').textContent = message;
  $('peer-status').classList.toggle('error', problem);
}

function refresh() {
  const open = channel?.readyState === 'open';
  $('peer-send').disabled = !open || sending;
  $('peer-create').disabled = Boolean(connection);
  $('peer-join').disabled = Boolean(connection);
  $('peer-confirm').disabled = role !== 'sender' || !connection ||
    connection.remoteDescription !== null;
  $('peer-disconnect').disabled = !connection;
  $('peer-download').disabled = !incomingBytes;
  $('connection-state').textContent = open ? 'Connected to peer' :
    connection ? 'Pairing in progress' : 'Disconnected';
}

function disconnect(message = 'Connection closed') {
  try { channel?.close(); } catch {}
  try { connection?.close(); } catch {}
  channel = null; connection = null; role = null;
  pendingSha = null; sending = false; inbox = new TransferReceiver();
  receiveQueue = Promise.resolve();
  $('peer-output').value = '';
  refresh();
  status(message);
}

function pcSetup(asRole) {
  if (!window.isSecureContext || typeof RTCPeerConnection !== 'function') {
    throw new Error('Use a modern browser over HTTPS with WebRTC enabled');
  }
  if (connection) throw new Error('Disconnect before creating another connection');
  role = asRole;
  connection = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  connection.addEventListener('connectionstatechange', () => {
    if (!connection) return;
    if (connection.connectionState === 'failed') {
      disconnect('Peer connection failed. Check firewall, NAT, or connection codes.');
    } else if (connection.connectionState === 'disconnected') {
      status('Connection interrupted. Waiting for network recovery...');
    } else if (connection.connectionState === 'connected') {
      refresh();
    }
  });
  connection.addEventListener('datachannel', event => bindChannel(event.channel));
  refresh();
  return connection;
}

function bindChannel(value) {
  if (channel && channel !== value) {
    value.close();
    return;
  }
  channel = value;
  channel.binaryType = 'arraybuffer';
  channel.addEventListener('open', () => { refresh(); status('Devices connected. You can send an encrypted file.'); });
  channel.addEventListener('close', () => {
    if (channel === value) { channel = null; pendingSha = null; sending = false; refresh(); status('Peer data channel closed.'); }
  });
  channel.addEventListener('message', event => {
    receiveQueue = receiveQueue.then(() => receiveMessage(event.data)).catch(error => {
      inbox.reset(); status(error.message || 'Invalid incoming transfer', true);
      try { channel?.send(JSON.stringify({ v: 1, type: 'error', reason: 'Transfer rejected' })); } catch {}
    });
  });
  refresh();
}

async function receiveMessage(data) {
  if (typeof data !== 'string') {
    if (!(data instanceof ArrayBuffer)) throw new Error('Unexpected binary frame');
    inbox.append(data);
    return;
  }
  let frame;
  try { frame = JSON.parse(data); } catch { throw new Error('Invalid peer control frame'); }
  if (!frame || frame.v !== 1 || typeof frame.type !== 'string') throw new Error('Invalid peer protocol');
  if (frame.type === 'start') {
    inbox.begin(frame);
    status('Receiving encrypted Strata package...');
  } else if (frame.type === 'finish') {
    const result = await inbox.finish(frame);
    incomingBytes = result.bytes;
    $('peer-download').disabled = false;
    status('Encrypted package received and SHA-256 verified. Download it, then open with its passphrase.');
    channel?.send(JSON.stringify({ v: 1, type: 'receipt', sha256: result.sha256 }));
  } else if (frame.type === 'receipt') {
    if (pendingSha && frame.sha256 === pendingSha) {
      pendingSha = null;
      status('Receiver confirmed the exact encrypted package arrived intact.');
    }
  } else if (frame.type === 'error') {
    pendingSha = null;
    status('The receiving device rejected the transfer.', true);
  } else {
    throw new Error('Unrecognized peer control frame');
  }
}

async function waitIce(pc) {
  if (pc.iceGatheringState === 'complete') return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const gathered = (pc.localDescription?.sdp || '').match(/^a=candidate:/gm);
      if (gathered?.length) {
        cleanup();
        resolve(); // STUN might be slow or blocked; local candidates can still work.
      } else {
        cleanup();
        reject(new Error('No usable network connection candidates. Retry or use an encrypted package.'));
      }
    }, 9000);
    function onState() { if (pc.iceGatheringState === 'complete') { cleanup(); resolve(); } }
    function cleanup() { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', onState); }
    pc.addEventListener('icegatheringstatechange', onState);
    onState();
  });
}

async function createInvite() {
  const pc = pcSetup('sender');
  bindChannel(pc.createDataChannel('strata.secure.package.v1', { ordered: true }));
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  status('Discovering a connection route...');
  await waitIce(pc);
  $('peer-output').value = encodeSignal(pc.localDescription);
  status('Invitation ready. Copy it to the other device using your own messaging channel.');
}

async function joinInvite() {
  const offer = decodeSignal($('peer-input').value, 'offer');
  const pc = pcSetup('receiver');
  await pc.setRemoteDescription(offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  status('Discovering a return route...');
  await waitIce(pc);
  $('peer-output').value = encodeSignal(pc.localDescription);
  status('Answer ready. Copy it back to the device that created the invitation.');
}

async function finishPairing() {
  if (!connection || role !== 'sender' || connection.remoteDescription) {
    throw new Error('Create an invitation on this device first');
  }
  await connection.setRemoteDescription(decodeSignal($('peer-input').value, 'answer'));
  status('Answer accepted. Establishing encrypted peer connection...');
  refresh();
}

function operate(fn) {
  return async () => {
    try { await fn(); } catch (error) {
      status(error.message || 'Operation failed', true);
      if (connection && !channel?.readyState?.includes('open') && role && !connection.remoteDescription) {
        disconnect(error.message || 'Pairing failed');
      }
    }
  };
}

$('peer-create').addEventListener('click', operate(createInvite));
$('peer-join').addEventListener('click', operate(joinInvite));
$('peer-confirm').addEventListener('click', operate(finishPairing));
$('peer-disconnect').addEventListener('click', () => disconnect());

$('peer-copy').addEventListener('click', operate(async () => {
  if (!$('peer-output').value) throw new Error('Create or join an invitation first');
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText($('peer-output').value);
    status('Connection code copied. Share it only with the intended peer.');
  } else {
    $('peer-output').focus(); $('peer-output').select();
    status('Select and copy this connection code to the other device.');
  }
}));

$('peer-send').addEventListener('click', operate(async () => {
  if (sending || channel?.readyState !== 'open') throw new Error('Connect to a peer before sending');
  const file = $('peer-file').files?.[0];
  if (!file || file.size > MAX_FILE_BYTES) throw new Error('Choose a file up to 16 MiB');
  const secret = $('peer-pass').value;
  if (!secret || secret.length < 12) throw new Error('Use a passphrase of at least 12 characters');
  sending = true; refresh();
  try {
    status('Encrypting selected file in your browser...');
    const result = await sealFile(file, secret);
    $('peer-pass').value = '';
    status('Sending encrypted package to peer...');
    const fingerprint = await sendPackage(channel, JSON.stringify(result.package),
      (sent, total) => { $('peer-progress').value = sent / total * 100; });
    pendingSha = fingerprint;
    status('Encrypted transfer sent. Waiting for receiver integrity receipt...');
  } finally { sending = false; refresh(); }
}));

$('peer-download').addEventListener('click', () => {
  if (!incomingBytes) return;
  const blob = new Blob([incomingBytes], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = 'strata-received-' + Date.now() + '.strata';
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  status('Encrypted package downloaded. Open it in Strata Workspace with the separate passphrase.');
});
window.addEventListener('pagehide', () => { try { channel?.close(); connection?.close(); } catch {} });
refresh();
