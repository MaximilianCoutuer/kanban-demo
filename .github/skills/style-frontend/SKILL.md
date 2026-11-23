---
name: style-frontend
description: Apply and verify 50px rounded corners across the frontend UI when styling or changing visual elements.
---

# Style Frontend

## Rule

Set `border-radius: 50px` on all UI elements, including frames, bordered
containers, cards, buttons, inputs, menus, dialogs, images, and visible
pseudo-elements. Apply the same radius to all four corners, including in
interactive states and responsive layouts. Do not substitute percentages,
different radius values, or square corners.

## Procedure

1. Inspect the frontend's existing styles and reusable components.
2. Apply the rule using the project's existing styling conventions. Update
   conflicting component, state, and responsive overrides as needed.
3. Keep content, interactions, focus indicators, and accessibility intact.
   When a background or image must follow the rounded edge, ensure it is
   clipped appropriately without hiding essential content or focus indicators.
4. Verify representative elements and states in the running UI, including
   their computed border radii, and run the relevant frontend checks.

## Example

```css
/* Correct: each corner has the required radius. */
.card {
  border: 1px solid currentColor;
  border-radius: 50px;
}

/* Incorrect: a different radius or a percentage does not meet the rule. */
.button {
  border-radius: 8px;
}
```
