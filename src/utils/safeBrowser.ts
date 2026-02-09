export const safeGetLocalStorage = (key: string, fallback = ''): string => {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return value ?? fallback;
  } catch {
    return fallback;
  }
};

export const safeSetLocalStorage = (key: string, value: string): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};

export const safeGetSessionStorage = (key: string, fallback = ''): string => {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = window.sessionStorage.getItem(key);
    return value ?? fallback;
  } catch {
    return fallback;
  }
};

export const safeSetSessionStorage = (key: string, value: string): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    window.sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};

const copyWithTextareaFallback = (text: string): boolean => {
  let textarea: HTMLTextAreaElement | null = null;
  try {
    textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    return ok;
  } catch {
    return false;
  } finally {
    if (textarea && textarea.parentNode) {
      textarea.parentNode.removeChild(textarea);
    }
  }
};

export const safeCopyToClipboard = async (text: string): Promise<boolean> => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (!text) return false;

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback below
  }

  return copyWithTextareaFallback(text);
};
