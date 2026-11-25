// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderRig, resetRig } from '../../test/rig-testing';
import { applyRuntime } from '../environment';

afterEach(resetRig);
const response = value => ({ ok: true, status: 200, json: async () => value });
// the voice tour lives in the sidebar's Help menu
const openVoiceTour = () => { fireEvent.click(screen.getByRole('button', { name: 'Help' })); fireEvent.click(screen.getByRole('menuitem', { name: 'Voice tour' })); };
it('offers the tour on request without playing audio, and reopens it', async () => {
  const requests = [];
  const fetchImpl = vi.fn(async (url, options = {}) => { requests.push({ url, method: options.method || 'GET' }); return { ok: false, status: 404, json: async () => ({ error: 'Not primed' }) }; });
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  renderRig('#/rig/home', { fetchImpl });
  expect(screen.queryByRole('dialog')).toBeNull();
  await screen.findByRole('button', { name: 'Help' }); openVoiceTour();
  const tour = await screen.findByRole('dialog', { name: 'Find your way around TraceHarness' });
  expect(play).not.toHaveBeenCalled();
  expect(within(tour).getByText(/^Chapter 1 of \d+$/)).toBeTruthy();   // sentence case, no uppercase kicker
  expect(tour.textContent).not.toMatch(/FIRST STEPS|CHAPTER/);
  expect(within(tour).getByRole('region', { name: 'Narration transcript' }).textContent).toContain('recorded');
  fireEvent.click(within(tour).getByRole('button', { name: 'Play narration' }));
  expect(play).toHaveBeenCalledTimes(1);
  fireEvent.click(within(tour).getByRole('button', { name: 'Explore on my own' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  openVoiceTour();
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(requests.some(x => x.url === '/api/onboarding')).toBe(false);
});
it('answers workflow questions and navigates without sending a model request', async () => {
  const requests = [];
  renderRig('#/rig/home?dock=buddy', { fetchImpl: async (url, options = {}) => {
    requests.push({ url, method: options.method || 'GET' }); return response({ version: 1, seen: true });
  } });
  const input = await screen.findByRole('textbox', { name: 'Ask Buddy how to use TraceHarness' });
  fireEvent.change(input, { target: { value: 'How do I edit the full harness JSON?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Show me how' }));
  const answer = screen.getByRole('region', { name: 'Buddy guidance' });
  expect(answer.textContent).toContain('Apply JSON');
  fireEvent.click(within(answer).getByRole('button', { name: 'Open Harnesses › Configuration file' }));
  expect(location.hash).toContain('harnesses:view:file');
  expect(requests.every(x => x.method === 'GET')).toBe(true);
  expect(requests.every(x => !String(x.url).includes('openrouter'))).toBe(true);
});

it('a late playback promise cannot mark the next chapter as playing', async () => {
  let resolve;
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => new Promise(r => { resolve = r }));
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  renderRig('#/rig/home', { fetchImpl: async () => response({ version: 1, seen: true }) });
  openVoiceTour();
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
  const opener = screen.getByRole('button', { name: 'Help' });opener.focus();openVoiceTour();
  const tour = screen.getByRole('dialog'); const buttons = within(tour).getAllByRole('button').filter(b => !b.disabled);buttons.at(-1).focus();
  fireEvent.keyDown(buttons.at(-1), { key: 'Tab' });expect(document.activeElement).toBe(buttons[0]);
  fireEvent.keyDown(buttons[0], { key: 'k', ctrlKey: true });expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
  fireEvent.keyDown(buttons[0], { key: 'Escape' });expect(screen.queryByRole('dialog')).toBeNull();expect(document.activeElement).toBe(opener);
});
it('checks live runner availability without treating a disconnected catalog as runnable', async () => {
  applyRuntime({ capabilities: { 'run.container': { reason: 'ok' } } });
  renderRig('#/rig/home?dock=buddy', { fetchImpl: async url => url === '/api/onboarding' ? response({ version: 1, seen: true }) : response({ version: 1, runner: { available: false, message: 'Maintenance' }, runtimes: [], models: [], tasks: [], credentials_available: false, execution_available: false }) });
  fireEvent.change(screen.getByRole('textbox', { name: 'Ask Buddy how to use TraceHarness' }), { target: { value: 'Can I dispatch a task?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Show me how' }));
  const state = await screen.findByRole('region', { name: 'Live runner check' });
  await waitFor(() => expect(state.textContent).toContain('The local runner is unavailable'));
  expect(state.textContent).not.toContain('ready to run');
});
it('the Buddy chapter opens the actual workflow guide, not a different dock', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  renderRig('#/rig/home', { fetchImpl: async () => response({ version: 1, seen: true }) });
  openVoiceTour();
  for (let n = 0; n < 4; n++) fireEvent.click(screen.getByRole('button', { name: 'Next chapter' }));
  fireEvent.click(screen.getByRole('button', { name: 'Show me this workflow →' }));
  expect(await screen.findByRole('textbox', { name: 'Ask Buddy how to use TraceHarness' })).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
});
