// Inner menus handle Escape before it bubbles to the viewer. Native dialogs own Escape while open.
export function consumeEscape(event: KeyboardEvent): boolean {
  if (
    event.key !== 'Escape' ||
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    event.shiftKey ||
    document.querySelector('dialog:modal')
  )
    return false;
  event.preventDefault();
  return true;
}
