/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const https = require('node:https');
const { request } = require('../cloudfunctions/membership/lib/virtual-payment.js');

describe('membership HTTPS transport', () => {
  it('sends a JSON body once with its UTF-8 Content-Length and no chunked framing', async () => {
    const original = https.request;
    const calls: any[] = [];
    https.request = (url: string, options: any, callback: any) => {
      const req = new EventEmitter() as any;
      req.setHeader = (name: string, value: unknown) => {
        options.headers[name] = value;
      };
      req.setTimeout = () => req;
      req.write = () => {
        throw new Error('write must not be used');
      };
      req.end = (body: string | undefined) => {
        calls.push({ url, headers: { ...options.headers }, body });
        const response = new EventEmitter() as any;
        response.statusCode = 200;
        response.headers = {};
        queueMicrotask(() => {
          callback(response);
          response.emit('end');
        });
      };
      return req;
    };
    const body = JSON.stringify({ probe: '中文' });
    try {
      await expect(
        request(
          'POST',
          'https://example.invalid/probe',
          { 'Content-Type': 'application/json' },
          body,
        ),
      ).resolves.toMatchObject({ statusCode: 200 });
    } finally {
      https.request = original;
    }
    expect(calls).toEqual([
      {
        url: 'https://example.invalid/probe',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        body,
      },
    ]);
  });

  it('keeps a no-body request free of Content-Length and Transfer-Encoding', async () => {
    const original = https.request;
    let call: any;
    https.request = (_url: string, options: any, callback: any) => {
      const req = new EventEmitter() as any;
      req.setHeader = (name: string, value: unknown) => {
        options.headers[name] = value;
      };
      req.setTimeout = () => req;
      req.write = () => {
        throw new Error('write must not be used');
      };
      req.end = (body: undefined) => {
        call = { headers: { ...options.headers }, body };
        const response = new EventEmitter() as any;
        response.statusCode = 200;
        response.headers = {};
        queueMicrotask(() => {
          callback(response);
          response.emit('end');
        });
      };
      return req;
    };
    try {
      await request('POST', 'https://example.invalid/probe', { Accept: 'application/json' });
    } finally {
      https.request = original;
    }
    expect(call).toEqual({ headers: { Accept: 'application/json' }, body: undefined });
  });

  it('uses an absolute eight-second deadline when no response arrives', async () => {
    vi.useFakeTimers();
    const original = https.request;
    const destroy = vi.fn();
    https.request = () => {
      const req = new EventEmitter() as any;
      req.destroy = destroy;
      req.end = () => undefined;
      return req;
    };
    try {
      const pending = request('GET', 'https://example.invalid/probe', {});
      const expected = expect(pending).rejects.toThrow('timeout');
      await vi.advanceTimersByTimeAsync(8_000);
      await expected;
      expect(destroy).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      https.request = original;
      vi.useRealTimers();
    }
  });

  it('keeps the absolute deadline while a response trickles data', async () => {
    vi.useFakeTimers();
    const original = https.request;
    const destroy = vi.fn();
    https.request = (_url: string, _options: any, callback: any) => {
      const req = new EventEmitter() as any;
      req.destroy = destroy;
      req.end = () => {
        const response = new EventEmitter() as any;
        response.statusCode = 200;
        response.headers = {};
        callback(response);
        setInterval(() => response.emit('data', Buffer.from('.')), 1_000);
      };
      return req;
    };
    try {
      const pending = request('GET', 'https://example.invalid/probe', {});
      const expected = expect(pending).rejects.toThrow('timeout');
      await vi.advanceTimersByTimeAsync(8_000);
      await expected;
      expect(destroy).toHaveBeenCalledOnce();
    } finally {
      https.request = original;
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it.each(['aborted', 'error'] as const)('rejects when the response emits %s', async (event) => {
    const original = https.request;
    https.request = (_url: string, _options: any, callback: any) => {
      const req = new EventEmitter() as any;
      req.destroy = () => undefined;
      req.end = () => {
        const response = new EventEmitter() as any;
        response.statusCode = 200;
        response.headers = {};
        callback(response);
        response.emit(event, event === 'error' ? new Error('stream failure') : undefined);
      };
      return req;
    };
    try {
      await expect(request('GET', 'https://example.invalid/probe', {})).rejects.toThrow();
    } finally {
      https.request = original;
    }
  });

  it('rejects a response closed before it is complete', async () => {
    const original = https.request;
    https.request = (_url: string, _options: any, callback: any) => {
      const req = new EventEmitter() as any;
      req.destroy = () => undefined;
      req.end = () => {
        const response = new EventEmitter() as any;
        response.statusCode = 200;
        response.headers = {};
        response.complete = false;
        callback(response);
        response.emit('close');
      };
      return req;
    };
    try {
      await expect(request('GET', 'https://example.invalid/probe', {})).rejects.toThrow(
        'incomplete response',
      );
    } finally {
      https.request = original;
    }
  });

  it('clears its deadline after a complete response', async () => {
    vi.useFakeTimers();
    const original = https.request;
    https.request = (_url: string, _options: any, callback: any) => {
      const req = new EventEmitter() as any;
      req.destroy = () => undefined;
      req.end = () => {
        const response = new EventEmitter() as any;
        response.statusCode = 200;
        response.headers = {};
        response.complete = true;
        callback(response);
        response.emit('end');
      };
      return req;
    };
    try {
      await expect(request('GET', 'https://example.invalid/probe', {})).resolves.toMatchObject({
        statusCode: 200,
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      https.request = original;
      vi.useRealTimers();
    }
  });
});
