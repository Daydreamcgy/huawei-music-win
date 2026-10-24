// Keep page merging deterministic so a stalled provider page cannot grow the list forever.
export function mergeFavoritesPage(existingTracks, page) {
  const knownIds = new Set(existingTracks.map(track => track.id));
  const appended = page.tracks.filter(track => {
    if (knownIds.has(track.id)) return false;
    knownIds.add(track.id);
    return true;
  });
  return {
    tracks: [...existingTracks, ...appended],
    nextStart: page.nextStart,
    hasMore: page.hasMore && appended.length > 0,
  };
}
