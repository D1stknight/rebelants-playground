
  // ✅ Guard: mget with zero keys throws ERR wrong number of arguments
  if (slice.length === 0) {
    return res.status(200).json({ ok: true, count: 0, claimIds: [], claims: [] });
  }
null