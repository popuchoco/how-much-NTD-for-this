# Interface direction

## Product world

This is a small Taiwan cash-desk tool: a clear amount-entry area, a denomination selector, and a practical comparison of change combinations. It should feel like a well-organized cash-counting counter, not a fintech sales page.

## Shared visual contract

- **Canvas:** cool ledger gray-green `#edf1ee`; white `#ffffff` for working surfaces.
- **Ink:** deep green-black `#1d302f` for primary text; muted slate-green `#4d625f` for secondary text.
- **Currency accent:** teal-green `#1d5c58` for selections, totals, and primary actions.
- **Secondary accent:** banknote red `#a63335` for headings, notes, and alerts; do not use color as the only state cue.
- **Typography:** platform system sans for all copy; tabular numerals for amounts and dates. No remote font request, so the tool remains self-contained and does not contact a font host.
- **Surfaces:** moderate 6–12px corners, thin cool borders, restrained shadow on the two primary panels only.
- **Navigation and footer:** same compact top navigation and license footer across the calculator, make-up, about, and life-applications pages.

## Page structure

- **Calculator:** amount entry and filters remain on the left; result summary and combinations remain on the right. On narrow screens, these stack in task order. A compact, labeled payment-scenario group keeps exact tender as the default and offers a consumer option capped at NT$20 change; the result list explicitly shows payment/change and sorts least change first.
- **About:** banknotes and coins use paired official CBC front/back photographs; design notes and issue dates stay directly beneath each face pair. Commemorative coins remain a separate explanatory section and are not calculator denominations.
- **Life applications:** six original Grade 2-friendly money scenarios plus Grade 3 estimation and Grade 4 rounding extensions use short prompts and native disclosure answers. The page lists only the corresponding curriculum-area text, not PDF links or reproduced worksheets. Upper-grade estimates are clearly distinguished from exact payment.
- **Make-up amount:** a two-column task/result view accepts either a known held total or per-denomination counts, then shows the remainder and available top-up combinations. It reuses the calculator's established results language and colors.
- Original Q-style SVGs remain in the calculator for quick denomination recognition; their main colors now follow the corresponding CBC note/coin photographs as a soft visual cue. The SVGs are still stylized teaching icons, not color-accurate reproductions; official photos are confined to the explanatory page.

## Signature detail

The about page pairs the two faces of each denomination in a compact, labeled photo strip. The images are the original CBC files, only scaled to fit; no crops, recoloring, redraws, or CBC branding are added.

## Accessibility baseline

- Visible labels and helper/error text remain attached to controls.
- Payment scenario choices use native grouped radio controls with visible descriptions; payment and change amounts are both printed in consumer mode rather than communicated by color or order alone.
- Calculation updates use a compact `role="status"` announcement instead of putting the full combination list in a live region.
- Keyboard focus is explicit and uses a consistent 3px ring.
- Main interactive controls provide at least a 44px target; responsive layouts reflow without horizontal scrolling.
- Life-application answers use native `<details>` / `<summary>` controls so they are keyboard-operable and work without JavaScript.
- Make-up inputs use visible labels, grouped fieldsets, nearby error feedback, a concise live status, and responsive count grids; entered amounts and counts are never stored.
- Reduced-motion preferences remain respected; content does not depend on animation or color alone.
