import { Modal } from '../../primitives'

/** Every key the workbench answers to (plan 5.7). Handlers sit on the workbench, never on the window. */
export const SHORTCUTS = [
  ['/', 'Anywhere in the workbench, outside a text field', 'Focus the search field'],
  ['↑ ↓ Home End', 'Prompt list', 'Move the active row; more rows load when needed'],
  ['Page Up · Page Down', 'Prompt list', 'Move ten rows'],
  ['Enter', 'Prompt list', 'Open the inspector for the active row'],
  ['Space', 'Prompt list', 'Select or clear the active row'],
  ['Ctrl/⌘ + A', 'Prompt list', 'Select every patchable row that matches the filters'],
  ['[  ]', 'Inspector, outside a text field', 'Previous or next fragment in the current order'],
  ['Ctrl/⌘ + Enter', 'Replacement text', 'Apply replacement'],
  ['Escape', 'Narrow inspector · focus mode · dialogs', 'Back to the list · exit · close'],
  ['Ctrl/⌘ + Z', 'Outside a text field', 'Undo the last profile change'],
  ['Shift + Ctrl/⌘ + Z', 'Outside a text field', 'Redo'],
  ['← →', 'View tabs and fragment tabs', 'Previous or next view'],
  ['?', 'Outside a text field', 'Show this list'],
]

export function ShortcutsHelp({ onClose }) {
  return <Modal open onClose={onClose} title="Keyboard shortcuts" width="640px" el="native-shortcuts"
    footer={<button type="button" className="rg-btn" onClick={onClose}>Close</button>}>
    <p className="rg-native-lede">Keys act on the workbench only. While a text field, a select or a dialog has focus, it keeps its own keys.</p>
    <dl className="rg-native-keys">{SHORTCUTS.map(([keys, where, effect]) => <div key={keys}>
      <dt><kbd>{keys}</kbd></dt><dd><span>{effect}</span><span className="rg-native-keys-where">{where}</span></dd></div>)}</dl>
  </Modal>
}
