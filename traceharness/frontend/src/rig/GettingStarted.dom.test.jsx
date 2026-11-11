// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
vi.hoisted(() => { window.__TRACEHARNESS_MEMBER__ = { version: 1, scope: 'a'.repeat(24) }; window.__TRACEHARNESS_DATA__ = {}; });
import { renderRig, resetRig } from '../../test/rig-testing';

afterEach(resetRig);
const response = value => ({ ok: true, status: 200, json: async () => value });
it('offers the tour on first member visit without playing audio, remembers dismissal and can reopen it', async () => {
  let seen = false; const requests = [];
  const fetchImpl = vi.fn(async (url, options = {}) => {
    requests.push({ url, method: options.method || 'GET' });
    if (url === '/api/onboarding') { if (options.method === 'POST') seen = true; return response({ version: 1, seen }); }
    return { ok: false, status: 404, json: async () => ({ error: 'Not primed' }) };
  });
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  renderRig('#/rig/home', { fetchImpl });
  const tour = await screen.findByRole('dialog', { name: 'Find your way around TraceHarness' });
  expect(play).not.toHaveBeenCalled();
  expect(within(tour).getByRole('region', { name: 'Narration transcript' }).textContent).toContain('recorded');
  fireEvent.click(within(tour).getByRole('button', { name: 'Play narration' }));
  expect(play).toHaveBeenCalledTimes(1);
  fireEvent.click(within(tour).getByRole('button', { name: 'Explore on my own' }));
  await screen.findByRole('button', { name: 'Voice tour' });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Voice tour' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(requests.every(x => x.url === '/api/onboarding')).toBe(true);
});
it('answers hosted workflow questions and navigates without sending a model request', async () => {
  const requests = [];
  renderRig('#/rig/home?dock=buddy', { fetchImpl: async (url, options = {}) => {
    requests.push({ url, method: options.method || 'GET' }); return response({ version: 1, seen: true });
  } });
  const input = await screen.findByRole('textbox', { name: 'Ask Buddy how to use TraceHarness' });
  fireEvent.change(input, { target: { value: 'How do I edit the full harness JSON?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Show me how' }));
  const answer = screen.getByRole('region', { name: 'Buddy guidance' });
  expect(answer.textContent).toContain('Apply JSON');
  fireEvent.click(within(answer).getByRole('button', { name: 'Open Harnesses' }));
  expect(location.hash).toContain('harnesses');
  expect(requests.every(x => x.method === 'GET')).toBe(true);
  expect(requests.every(x => !String(x.url).includes('openrouter'))).toBe(true);
});

it('does not interrupt interaction when the first-visit read arrives late', async () => {
  let resolve;
  renderRig('#/rig/home', { fetchImpl: () => new Promise(r => { resolve = r }) });
  fireEvent.keyDown(window, { key: 'Tab' });
  await act(async () => resolve(response({ version: 1, seen: false })));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Voice tour' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
});
it('reports a failed account acknowledgement without blocking the workbench', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  renderRig('#/rig/home', { fetchImpl: async (_url, options = {}) => options.method === 'POST' ? { ok: false, status: 503, json: async () => ({ error: 'Unavailable' }) } : response({ version: 1, seen: false }) });
  const tour = await screen.findByRole('dialog');
  fireEvent.click(within(tour).getByRole('button', { name: 'Explore on my own' }));
  await screen.findByRole('button', { name: 'Remember tour dismissal' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('navigation', { name: 'Activity' })).toBeTruthy();
});
it('a late playback promise cannot mark the next chapter as playing', async () => {
  let resolve;
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => new Promise(r => { resolve = r }));
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  renderRig('#/rig/home', { fetchImpl: async () => response({ version: 1, seen: true }) });
  fireEvent.click(screen.getByRole('button', { name: 'Voice tour' }));
  fireEvent.click(screen.getByRole('button', { name: 'Play narration' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next chapter' }));
  await act(async () => resolve());
  expect(screen.getByRole('button', { name: 'Play narration' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Pause narration' })).toBeNull();
  expect(screen.getByRole('region', { name: 'Narration transcript' }).textContent).toContain('saved manifest');
});
it('contains keyboard focus, prevents shell shortcuts and restores the opener on Escape', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  renderRig('#/rig/home', { fetchImpl: async () => response({ version: 1, seen: true }) });
  const opener = screen.getByRole('button', { name: 'Voice tour' });opener.focus();fireEvent.click(opener);
  const tour = screen.getByRole('dialog'); const buttons = within(tour).getAllByRole('button').filter(b => !b.disabled);buttons.at(-1).focus();
  fireEvent.keyDown(buttons.at(-1), { key: 'Tab' });expect(document.activeElement).toBe(buttons[0]);
  fireEvent.keyDown(buttons[0], { key: 'k', ctrlKey: true });expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
  fireEvent.keyDown(buttons[0], { key: 'Escape' });expect(screen.queryByRole('dialog')).toBeNull();expect(document.activeElement).toBe(opener);
});
it('checks live runner availability without treating a disconnected catalog as runnable', async () => {
  renderRig('#/rig/home?dock=buddy', { fetchImpl: async url => url === '/api/onboarding' ? response({ version: 1, seen: true }) : response({ version: 1, runner: { available: false, message: 'Maintenance' }, runtimes: [], models: [], tasks: [], credentials_available: false, execution_available: false }) });
  fireEvent.change(screen.getByRole('textbox', { name: 'Ask Buddy how to use TraceHarness' }), { target: { value: 'Can I dispatch a task?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Show me how' }));
  const state = await screen.findByRole('region', { name: 'Live runner check' });
  await waitFor(() => expect(state.textContent).toContain('Hosted execution is unavailable'));
  expect(state.textContent).not.toContain('ready to run');
});
it('the Buddy chapter opens the actual workflow guide, not a different dock', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  renderRig('#/rig/home', { fetchImpl: async () => response({ version: 1, seen: true }) });
  fireEvent.click(screen.getByRole('button', { name: 'Voice tour' }));
  for (let n = 0; n < 4; n++) fireEvent.click(screen.getByRole('button', { name: 'Next chapter' }));
  fireEvent.click(screen.getByRole('button', { name: 'Show me this workflow →' }));
  expect(await screen.findByRole('textbox', { name: 'Ask Buddy how to use TraceHarness' })).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
});
