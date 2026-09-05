/** This fork defaults to personal use. Explicit false restores its commercial UI. */
export function isPersonalMode(value?: string): boolean {
    return value?.trim().toLowerCase() !== 'false'
}

export const IS_PERSONAL_MODE = isPersonalMode(import.meta.env?.VITE_PERSONAL_MODE)
