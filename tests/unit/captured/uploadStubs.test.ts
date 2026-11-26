// @vitest-environment node
// A replay has no upload service, so a page that sends the file it was given gets no answer and clears its
// box. The stubs answer in each site's own protocol, so the score shows what the fill did, not what the
// recording lacks.
import { describe, expect, it } from 'vitest';
import { STORAGE_ORIGIN, storesItself, uploadReply } from '../../shared/uploadStubs';

const json = (reply: ReturnType<typeof uploadReply>): Record<string, any> => JSON.parse(reply!.body);

/** A multipart body the way a browser sends a storage form: its fields, then the file. */
function multipart(fields: Record<string, string>): { body: string; contentType: string } {
  const boundary = '----replayBoundary';
  const parts = Object.entries(fields).map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`);
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="cv.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\r\n`);
  return { body: `${parts.join('')}--${boundary}--\r\n`, contentType: `multipart/form-data; boundary=${boundary}` };
}

describe('upload stubs', () => {
  it('answers Workable: a storage form to post to, and the link the file will have', () => {
    const reply = uploadReply({ method: 'GET', url: 'https://apply.workable.com/api/v1/jobs/ABC123/form/upload/resume?contentType=application%2Fpdf' });
    expect(reply?.status).toBe(200);
    const body = json(reply);
    expect(body.uploadPostUrl.url.startsWith(STORAGE_ORIGIN)).toBe(true);
    expect(typeof body.uploadPostUrl.fields.key).toBe('string');
    expect(body.downloadUrl.startsWith(STORAGE_ORIGIN)).toBe(true);
  });

  it('answers Rippling: its reply wraps the storage form and the final link in `data`', () => {
    const reply = uploadReply({
      method: 'GET',
      url: 'https://ats.rippling.com/api/v1/utility/file_upload_url?contentType=application%2Fpdf&jobBoardSlug=some-board',
    });
    expect(reply?.status).toBe(200);
    const { data } = json(reply);
    expect(data.url.startsWith(STORAGE_ORIGIN)).toBe(true);
    expect(typeof data.fields.key).toBe('string');
    expect(data.finalUrl.url.startsWith(STORAGE_ORIGIN)).toBe(true);
  });

  it('answers Teamtailor: a key the page puts the file name into', () => {
    const reply = uploadReply({
      method: 'POST',
      url: 'https://somecompany.teamtailor.com/uploads/presigned_data',
      postData: JSON.stringify({ filename: 'cv.pdf' }),
    });
    expect(reply?.status).toBe(200);
    expect(reply?.headers['content-type']).toMatch(/application\/json/);
    const body = json(reply);
    expect(body.url.startsWith(STORAGE_ORIGIN)).toBe(true);
    expect(body.fields.key).toContain('${filename}');
  });

  it('takes the storage post the way S3 does: 204, with the stored file at Location, readable cross-origin', () => {
    const { body, contentType } = multipart({ key: 'uploads/abc/cv.pdf', 'Content-Type': 'application/pdf' });
    const reply = uploadReply({ method: 'POST', url: `${STORAGE_ORIGIN}/teamtailor/`, postData: body, headers: { 'content-type': contentType } });
    expect(reply?.status).toBe(204);
    expect(reply?.headers.location).toBe(`${STORAGE_ORIGIN}/teamtailor/uploads%2Fabc%2Fcv.pdf`);
    expect(reply?.headers['access-control-allow-origin']).toBe('*');
    expect(reply?.headers['access-control-expose-headers']).toMatch(/location/i);
  });

  it('answers the storage preflight', () => {
    const reply = uploadReply({ method: 'OPTIONS', url: `${STORAGE_ORIGIN}/rippling/` });
    expect(reply?.status).toBe(204);
    expect(reply?.headers['access-control-allow-methods']).toMatch(/POST/);
  });

  it('answers Moka: the resume it stored, in its usual wrapper, with nothing read out of a blank page', () => {
    const boundary = '----replayBoundary';
    const body =
      `--${boundary}\r\nContent-Disposition: form-data; name="orgId"\r\n\r\nexample-org\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="resume"; filename="示例-简历.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\r\n--${boundary}--\r\n`;
    const reply = uploadReply({
      method: 'POST',
      url: 'https://app.mokahr.com/api/outer/ats-candidate-extractor/resume/uploadAndParse/candidate',
      postData: body,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    expect(reply?.status).toBe(200);
    const { code, success, data } = json(reply);
    expect({ code, success }).toEqual({ code: 0, success: true });
    expect(data).toEqual({ resumeKey: expect.any(String), resumeName: '示例-简历.pdf' });
  });

  it('answers BambooHR: the file it holds for the application, under an id of its own', () => {
    const boundary = '----replayBoundary';
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="upload"; filename="Sample-Resume.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\r\n--${boundary}--\r\n`;
    const request = {
      method: 'POST',
      url: 'https://acme.bamboohr.com/ajax/files/attachTemporary.php',
      postData: body,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    };
    const reply = uploadReply(request);
    expect(reply?.status).toBe(200);
    expect(json(reply)).toEqual({ status: 'OK', fid: expect.any(String), name: 'Sample-Resume.pdf', type: 'application/pdf', size: expect.any(Number) });
    expect(storesItself(request)).toBe(true);
    expect(uploadReply({ ...request, url: 'https://example.com/ajax/files/attachTemporary.php' })).toBeNull();
  });

  it('a Moka upload is the file itself, so nothing waits for a storage post after it', () => {
    expect(storesItself({ method: 'POST', url: 'https://app.mokahr.com/api/outer/ats-candidate-extractor/resume/uploadAndParse/candidate' })).toBe(true);
    expect(storesItself({ method: 'GET', url: 'https://apply.workable.com/api/v1/jobs/ABC123/form/upload/resume' })).toBe(false);
  });

  it('leaves everything else to the recording', () => {
    expect(uploadReply({ method: 'POST', url: 'https://app.mokahr.com/api/outer/ats-candidate-extractor/resume/uploadAndParse/idCard' })).toBeNull();
    expect(uploadReply({ method: 'GET', url: 'https://apply.workable.com/api/v1/jobs/ABC123/form' })).toBeNull();
    expect(uploadReply({ method: 'POST', url: 'https://ats.rippling.com/api/v1/apply' })).toBeNull();
    expect(uploadReply({ method: 'GET', url: 'https://somecompany.teamtailor.com/uploads/presigned_data' })).toBeNull();
  });
});
