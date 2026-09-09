import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PhotosHome } from '../../src/photos/PhotosHome';
import { MockPhotoSource } from '../../src/photos/sources/MockPhotoSource';

describe('PhotosHome smoke', () => {
  it('renders the timeline and opens the backup panel without crashing', async () => {
    const source = new MockPhotoSource();
    const { unmount } = render(<PhotosHome source={source} />);

    // Header appears after the mock library loads.
    await waitFor(() => expect(screen.getByText(/Photos/)).toBeTruthy(), { timeout: 3000 });

    // The library was loaded (some photo/video tile button exists).
    const tiles = document.querySelectorAll('.photos-cell');
    expect(tiles.length).toBeGreaterThan(0);

    // Backup screen opens from the cloud button.
    const backupButtons = screen.getAllByRole('button', { name: /Back up/i });
    expect(backupButtons.length).toBeGreaterThan(0);

    unmount();
  });
});
