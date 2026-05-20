import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createServer } from '../server/app.js';

const app = createServer();

describe('GET /api/health', () => {
  it('returns 200 with timestamp', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.timestamp).toBeTruthy();
  });

  it('returns 404 for unknown routes', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
