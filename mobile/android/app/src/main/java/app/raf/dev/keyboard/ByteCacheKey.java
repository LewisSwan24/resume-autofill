package app.raf.dev.keyboard;

/** Identifies one version of keyboard.enc by its length and modification time, so an unchanged file is not reopened. */
final class ByteCacheKey {
    final long length;
    final long lastModified;

    ByteCacheKey(long length, long lastModified) {
        this.length = length;
        this.lastModified = lastModified;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof ByteCacheKey)) return false;
        ByteCacheKey k = (ByteCacheKey) o;
        return length == k.length && lastModified == k.lastModified;
    }

    @Override
    public int hashCode() {
        return (int) (length * 31 + lastModified);
    }
}
