import { useEffect } from 'react';

/**
 * Custom hook to set document title dynamically.
 * Automatically appends " | ZapLink" suffix.
 */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${title} | ZapLink`;

    return () => {
      document.title = previousTitle;
    };
  }, [title]);
}
