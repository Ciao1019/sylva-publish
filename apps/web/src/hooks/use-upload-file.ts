import * as React from 'react';

export interface UploadedFile {
  key: string;
  url: string;
  name: string;
  size: number;
  type: string;
}

interface UseUploadFileProps {
  onUploadComplete?: (file: UploadedFile) => void;
  onUploadError?: (error: unknown) => void;
}

const UPLOAD_UNSUPPORTED = '发布站为只读站点，不支持上传文件';

/** 发布站只读：保留 Plate 媒体占位节点依赖的接口形状，上传一律拒绝。 */
export function useUploadFile({ onUploadError }: UseUploadFileProps = {}) {
  const uploadFile = React.useCallback(async (_file: File): Promise<UploadedFile> => {
    const error = new Error(UPLOAD_UNSUPPORTED);
    onUploadError?.(error);
    throw error;
  }, [onUploadError]);

  return {
    isUploading: false,
    progress: 0,
    uploadedFile: undefined as UploadedFile | undefined,
    uploadFile,
    uploadingFile: undefined as File | undefined,
  };
}
