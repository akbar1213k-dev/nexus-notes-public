export type LockAction = 'delete' | 'copy' | 'delete copy' | 'all';
export type LockType = 'delete' | 'copy' | 'delete copy' | 'none';

// Normalizes overlapping lock intents into standard formats
function normalizeLock(lockSet: Set<string>): LockType {
    const hasDelete = lockSet.has('delete');
    const hasCopy = lockSet.has('copy');
    if (hasDelete && hasCopy) return 'delete copy';
    if (hasDelete) return 'delete';
    if (hasCopy) return 'copy';
    return 'none';
}

function getCombinedLock(curr: string | null, add: string): LockType {
    const set = new Set((curr || '').split(' ').filter(Boolean));
    add.split(' ').filter(Boolean).forEach(l => set.add(l));
    return normalizeLock(set);
}

function getSubtractedLock(curr: string | null, remove: string): LockType {
    if (remove === 'all') return 'none';
    const set = new Set((curr || '').split(' ').filter(Boolean));
    remove.split(' ').filter(Boolean).forEach(l => set.delete(l));
    return normalizeLock(set);
}

// Safely isolates text nodes bounding the range. (Used strictly for applyLock)
function isolateRangeText(range: Range): Text[] {
    if (range.collapsed) return [];

    const textNodes: Text[] = [];
    const commonAncestor = range.commonAncestorContainer;
    const walkerRoot = commonAncestor.nodeType === Node.TEXT_NODE 
        ? commonAncestor.parentNode || commonAncestor 
        : commonAncestor;
    
    const walker = document.createTreeWalker(walkerRoot, NodeFilter.SHOW_TEXT, null);
    let node = walker.nextNode();
    
    while (node) {
        if (range.intersectsNode(node)) {
            const isBeforeStart = node === range.startContainer && range.startOffset === (node as Text).length;
            const isAfterEnd = node === range.endContainer && range.endOffset === 0;
            
            if (!isBeforeStart && !isAfterEnd) {
                textNodes.push(node as Text);
            }
        }
        node = walker.nextNode();
    }

    if (textNodes.length === 0) return [];

    const first = textNodes[0];
    const last = textNodes[textNodes.length - 1];

    if (range.endContainer === last && range.endOffset < last.length && range.endOffset > 0) {
        last.splitText(range.endOffset);
    }
    
    if (range.startContainer === first && range.startOffset > 0 && range.startOffset < first.length) {
        textNodes[0] = first.splitText(range.startOffset);
    }
    
    return textNodes;
}

/**
 * Normalizes locked regions by pushing <uneditable> wrappers down to the leaf text nodes.
 * Used strictly for safely applying NEW locks at exact selection boundaries.
 */
function pushDownLocks(textNodes: Text[]) {
    const ancestorsToUnwrap = new Set<HTMLElement>();
    
    for (const T of textNodes) {
        const uneditableAncestor = T.parentElement?.closest('uneditable') as HTMLElement | null;
        if (!uneditableAncestor) continue;
        
        if (uneditableAncestor.childNodes.length === 1 && uneditableAncestor.firstChild === T) {
            continue; 
        }
        ancestorsToUnwrap.add(uneditableAncestor);
    }
    
    for (const ancestor of ancestorsToUnwrap) {
        const lockStr = ancestor.getAttribute('data-lock') || '';
        const walker = document.createTreeWalker(ancestor, NodeFilter.SHOW_TEXT, null);
        const textsToWrap: Text[] = [];
        let n;
        while ((n = walker.nextNode())) {
            textsToWrap.push(n as Text);
        }
        
        textsToWrap.forEach(text => {
            const u = document.createElement('uneditable');
            u.setAttribute('data-lock', lockStr);
            text.parentNode?.insertBefore(u, text);
            u.appendChild(text);
        });
        
        const parent = ancestor.parentNode;
        if (parent) {
            while (ancestor.firstChild) {
                parent.insertBefore(ancestor.firstChild, ancestor);
            }
            parent.removeChild(ancestor);
        }
    }
}

function mergeAdjacentLocks(root: HTMLElement) {
    root.normalize(); 
    const uneditables = Array.from(root.querySelectorAll('uneditable'));
    for (const u of uneditables) {
        if (!u.isConnected) continue; 
        
        const prev = u.previousSibling;
        if (prev && prev.nodeType === Node.ELEMENT_NODE && (prev as HTMLElement).tagName.toLowerCase() === 'uneditable') {
            const prevU = prev as HTMLElement;
            if (prevU.getAttribute('data-lock') === u.getAttribute('data-lock')) {
                while (u.firstChild) {
                    prevU.appendChild(u.firstChild);
                }
                u.parentNode?.removeChild(u);
            }
        }
    }
    
    root.querySelectorAll('uneditable').forEach(u => {
        if (u.childNodes.length === 0) u.parentNode?.removeChild(u);
    });
}

/**
 * Applies a lock to the exact selected range natively.
 */
export function applyLock(range: Range, root: HTMLElement, lockToApply: LockAction): void {
    if (range.collapsed || lockToApply === 'all') return;

    const textNodes = isolateRangeText(range);
    pushDownLocks(textNodes);
    
    for (const T of textNodes) {
        const parent = T.parentElement;
        if (parent && parent.tagName.toLowerCase() === 'uneditable') {
            const currLock = parent.getAttribute('data-lock') || '';
            const newLock = getCombinedLock(currLock, lockToApply);
            if (currLock !== newLock) {
                parent.setAttribute('data-lock', newLock);
            }
        } else {
            const u = document.createElement('uneditable');
            u.setAttribute('data-lock', getCombinedLock('', lockToApply));
            T.parentNode?.insertBefore(u, T);
            u.appendChild(T);
        }
    }
    mergeAdjacentLocks(root);
}

/**
 * Removes specified locks. Whole-region semantic: Any intersected lock region 
 * is modified as a single unbroken structural unit.
 */
export function removeLock(range: Range, root: HTMLElement, lockToRemove: LockAction): void {
    if (range.collapsed) return;

    const uneditables = Array.from(root.querySelectorAll('uneditable'));
    const affected = uneditables.filter(u => range.intersectsNode(u));

    for (const u of affected) {
        const currLock = u.getAttribute('data-lock') || '';
        const newLock = getSubtractedLock(currLock, lockToRemove);

        if (newLock === 'none') {
            const parent = u.parentNode;
            if (parent) {
                while (u.firstChild) {
                    parent.insertBefore(u.firstChild, u);
                }
                parent.removeChild(u);
            }
        } else {
            u.setAttribute('data-lock', newLock);
        }
    }
    mergeAdjacentLocks(root);
}

export function getLocksInRange(range: Range, root: HTMLElement): Set<string> {
    const locks = new Set<string>();
    
    if (range.collapsed) {
        let node = range.startContainer;
        if (node.nodeType === Node.ELEMENT_NODE && node.childNodes.length > 0) {
            const u = (node as HTMLElement).closest('uneditable');
            if (u) {
                const lockStr = u.getAttribute('data-lock') || '';
                lockStr.split(' ').filter(Boolean).forEach(l => locks.add(l));
            }
            return locks;
        }
        
        if (node.nodeType === Node.TEXT_NODE) {
            const u = node.parentElement?.closest('uneditable');
            if (u) {
                const lockStr = u.getAttribute('data-lock') || '';
                lockStr.split(' ').filter(Boolean).forEach(l => locks.add(l));
            }
        }
        return locks;
    }

    const uneditables = Array.from(root.querySelectorAll('uneditable'));
    for (const u of uneditables) {
        if (range.intersectsNode(u)) {
            const lockStr = u.getAttribute('data-lock') || '';
            lockStr.split(' ').filter(Boolean).forEach(l => locks.add(l));
        }
    }
    return locks;
}