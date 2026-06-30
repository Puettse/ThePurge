import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_REMOTE_FILES,
  normalizeUploadedFiles,
  RemoteValidationError,
  validateRemoteMessagePayload,
} from '../src/services/remoteControlService.js';

test('remote message payload requires a channel and content or files', () => {
  assert.throws(
    () => validateRemoteMessagePayload({ channelId: '', content: 'hello' }),
    RemoteValidationError,
  );

  assert.throws(
    () => validateRemoteMessagePayload({ channelId: '123', content: '   ', files: [] }),
    RemoteValidationError,
  );
});

test('remote message payload accepts uploaded files without text content', () => {
  const payload = validateRemoteMessagePayload({
    channelId: '123',
    content: '',
    files: [{ name: 'report.txt', dataBase64: Buffer.from('ok').toString('base64') }],
  });

  assert.equal(payload.channelId, '123');
  assert.equal(payload.content, '');
  assert.equal(payload.files[0].name, 'report.txt');
  assert.equal(payload.files[0].buffer.toString(), 'ok');
});

test('remote uploads are sanitized and capped by count', () => {
  const files = normalizeUploadedFiles([
    { name: '../bad:name?.txt', dataBase64: Buffer.from('ok').toString('base64') },
  ]);

  assert.equal(files[0].name, '.._bad_name_.txt');

  assert.throws(
    () => normalizeUploadedFiles(Array.from({ length: MAX_REMOTE_FILES + 1 }, (_, index) => ({
      name: `file-${index}.txt`,
      dataBase64: Buffer.from('ok').toString('base64'),
    }))),
    RemoteValidationError,
  );
});
