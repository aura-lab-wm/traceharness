import { BudgetMeters } from './BudgetMeters'
import { CompareProfiles } from './CompareProfiles'

export const PROMPT_NOTE = 'The manifest and plan estimates leave out your additional instructions, which this panel cannot see. “Compare prompt variants” estimates the plan with them.'

/**
 * The Changes view: everything that differs from the inventory baseline (or between any two
 * profiles of this inventory), with its size, and a way back for each fragment.
 */
export function ChangesView({ wb }) {
  return <div className="rg-native-changes-view">
    {wb.profileIssue && <p className="rg-native-notice">The stored draft belongs to another inventory, so the comparison below shows the inventory baseline. Rebase the draft or start a new profile to see its changes here.</p>}
    <CompareProfiles key={wb.ui.compare} wb={wb} />
    <section className="rg-native-block" aria-labelledby={wb.idBase + '-size'}>
      <div className="rg-native-block-head"><h3 id={wb.idBase + '-size'}>Size and contract limits</h3></div>
      <BudgetMeters budget={wb.budget} note={PROMPT_NOTE} />
    </section>
  </div>
}
