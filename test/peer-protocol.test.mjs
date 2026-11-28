import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sealFile, openPackage } from '../public/app-core.mjs';
import {
  CHUNK_BYTES, MAX_TRANSFER_BYTES, encodeSignal, decodeSignal,
  startFrame, TransferReceiver, sendPackage
} from '../public/peer-protocol.mjs';

const file = (bytes, name = 'document.txt') => ({
  name, size: bytes.length, type: 'text/plain',
  arrayBuffer: async () => Uint8Array.from(bytes).buffer
});
const passphrase = 'a unique passphrase with at least twelve characters';

test('manual connection codes keep offer and answer types distinct', () => {
  const sdp = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n';
  const offer = encodeSignal({ type: 'offer', sdp });
  assert.deepEqual(decodeSignal(offer, 'offer'), { type: 'offer', sdp });
  assert.throws(() => decodeSignal(offer, 'answer'), /wrong type/);
  assert.throws(() => decodeSignal('not valid++', 'offer'), /Invalid connection code/);
  assert.throws(() => encodeSignal({ type: 'offer', sdp: 'bad' }), /Invalid/);
});

test('encrypted file goes over bounded frames and reconstructs with exact bytes', async () => {
  const original = new TextEncoder().encode('real Strata device transfer\n' + 'x'.repeat(31000));
  const sealed = await sealFile(file(original), passphrase);
  const serialized = JSON.stringify(sealed.package);
  const channel = {
    readyState: 'open', bufferedAmount: 0, bufferedAmountLowThreshold: 0, messages: [],
    send(msg) { this.messages.push(msg); },
    addEventListener() {}, removeEventListener() {}
  };
  const expected = await sendPackage(channel, serialized);
  const receive = new TransferReceiver();
  for (const msg of channel.messages) {
    if (typeof msg === 'string') {
      const control = JSON.parse(msg);
      if (control.type === 'start') receive.begin(control);
      if (control.type === 'finish') {
        const complete = await receive.finish(control);
        assert.equal(complete.sha256, expected);
        const output = await openPackage(new TextDecoder().decode(complete.bytes), passphrase);
        assert.equal(output.name, 'document.txt');
        assert.deepEqual(output.bytes, original);
      }
    } else {
      assert.ok(msg instanceof ArrayBuffer);
      assert.ok(msg.byteLength <= CHUNK_BYTES);
      receive.append(msg);
    }
  }
});

test('modified chunks cannot produce an accepted receipt', async () => {
  const { package: pkg } = await sealFile(file([1, 2, 3, 4]), passphrase);
  const { bytes, start } = await startFrame(JSON.stringify(pkg));
  const receive = new TransferReceiver();
  receive.begin(start);
  const damaged = bytes.slice();
  damaged[damaged.length - 3] ^= 1;
  for (let i = 0; i < damaged.length; i += CHUNK_BYTES) {
    receive.append(damaged.slice(i, i + CHUNK_BYTES));
  }
  await assert.rejects(receive.finish({ v: 1, type: 'finish' }), /SHA-256 mismatch/);
});

test('receiver rejects incomplete, overflowed and out-of-order frames', () => {
  const receive = new TransferReceiver();
  assert.throws(() => receive.append(new Uint8Array([1])), /not started/);
  assert.throws(() => receive.begin({ v: 1, type: 'start', length: MAX_TRANSFER_BYTES + 1, sha256: 'a'.repeat(64) }), /oversized/);
  receive.begin({ v: 1, type: 'start', length: 100, sha256: 'a'.repeat(64) });
  assert.throws(() => receive.begin({ v: 1, type: 'start', length: 100, sha256: 'a'.repeat(64) }), /in progress/);
  assert.throws(() => receive.append(new Uint8Array(101)), /Invalid transfer chunk/);
});

test('public site is product-first with functional paths and preserved technical records', () => {
  const home = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const connect = readFileSync(new URL('../public/connect.html', import.meta.url), 'utf8');
  assert.match(home, /href="\/connect\.html"/);
  assert.match(home, /href="\/app\.html"/);
  assert.match(home, /href="\/performance\.html"/);
  assert.match(home, /href="\/proof\.html"/);
  assert.match(connect, /id="peer-create"/);
  assert.match(connect, /id="peer-join"/);
  assert.match(connect, /id="peer-confirm"/);
  assert.match(connect, /id="peer-send"/);
  assert.match(connect, /id="peer-download"/);
  assert.match(connect, /no TURN relay/);
  assert.match(connect, /script-src 'self'/);
});
