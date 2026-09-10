/** 极简存储抽象（getItem/setItem 即可满足全部调用点）。 */
export interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}
