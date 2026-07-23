import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { renderBlocks } from '../lib/format';
import { unwrap } from './FeaturesModal';

// The "What's new" lightbox renders the real repo FEATURES.md through the
// shared block renderer. Guard the whole pipeline against the doc's structure
// (headings + soft-wrapped bullets) so a formatting change can't silently break
// the render.
describe('FeaturesModal render pipeline', () => {
  const md = readFileSync(path.resolve(process.cwd(), '../../FEATURES.md'), 'utf8');

  it('renders FEATURES.md to headings and list items without throwing', () => {
    const html = renderToStaticMarkup(<>{renderBlocks(unwrap(md), {}, undefined)}</>);
    expect(html).toContain('<h2');
    expect(html).toContain('<li');
    expect(html).toContain('Activity feed');
  });

  it('folds soft-wrapped bullet continuations into one line', () => {
    const src = ['- first line', '  continues here', '', '## Heading'].join('\n');
    expect(unwrap(src)).toBe(['- first line continues here', '', '## Heading'].join('\n'));
  });
});
