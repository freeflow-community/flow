import { useMemo } from 'react';
import { useRuntime } from '../state';

/** Capture the view's owning runtime, including callbacks that finish after a switch. */
export function useBoundApi() {
  const runtime = useRuntime();
  return useMemo(() => ({
    serverOrigin: runtime.origin,
    api: runtime.api.bind(runtime),
    blobUrl: runtime.blobUrl.bind(runtime),
    cachedBlobUrl: runtime.cachedBlobUrl.bind(runtime),
    fileStreamUrl: runtime.fileStreamUrl.bind(runtime),
    fileImageUrl: runtime.fileImageUrl.bind(runtime),
    fileText: runtime.fileText.bind(runtime),
    mintAppToken: runtime.mintAppToken.bind(runtime),
    uploadFile: runtime.uploadFile.bind(runtime),
    uploadAvatar: runtime.uploadAvatar.bind(runtime),
    uploadWorkspaceAvatar: runtime.uploadWorkspaceAvatar.bind(runtime),
    scopedStorageKey: runtime.key.bind(runtime),
  }), [runtime]);
}
