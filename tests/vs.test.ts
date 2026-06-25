import { describe, expect, it } from 'vitest';
import { createGateway } from '@localant/gateway';

describe('video tools', () => {
  it('registers', () => {
    const g = createGateway(process.cwd());
    const p = 'video_studio_';
    expect(g.registry.get(p + 'status')?.risk).toBe(0);
    expect(g.registry.get(p + 'create_project')?.risk).toBe(2);
    expect(g.registry.get(p + 'list_projects')?.risk).toBe(0);
    expect(g.registry.get(p + 'generate_video')?.risk).toBe(3);
    expect(g.registry.get(p + 'publish_prepare')?.risk).toBe(2);
    expect(g.registry.get(p + 'publish_video')?.risk).toBe(4);
  });
});
