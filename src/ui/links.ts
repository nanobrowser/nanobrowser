// Links to the Nanobrowser website. The tag names only the place in the extension the link is on, so the site can
// count the visits that came from the extension; it carries no identifier.

/** A page of the website (`/docs` is the help pages), tagged with the place that links to it. */
export const websiteUrl = (path: '/' | '/docs', place: 'side-panel' | 'settings' | 'about') =>
  `https://nanobrowser.ai${path}?utm_source=nanobrowser-extension&utm_medium=${place}`;
