export function getKeyAtPosition(
  position: number,
  positions: Record<string, number>,
  allKeys: string[]
): string | undefined {
  'worklet';
  return allKeys.find((key) => positions[key] === position);
}

/** Section key for a flat list position (nearest locked header at or above). */
export function getSectionAtPosition(
  position: number,
  positions: Record<string, number>,
  allKeys: string[],
  sectionByKey: Record<string, string>,
  lockedKeys: Record<string, boolean>
): string | undefined {
  'worklet';
  for (let pos = position; pos >= 0; pos--) {
    const keyAtPos = getKeyAtPosition(pos, positions, allKeys);
    if (!keyAtPos) {
      continue;
    }
    if (lockedKeys[keyAtPos]) {
      return sectionByKey[keyAtPos] ?? keyAtPos;
    }
  }
  return undefined;
}

/** True when a passive swap would move a non-dragged item into another section. */
export function wouldPassiveSwapCrossSection(
  itemToSwapId: string,
  passiveDestinationPosition: number,
  sectionByKey: Record<string, string>,
  positions: Record<string, number>,
  allKeys: string[],
  lockedKeys: Record<string, boolean>
): boolean {
  'worklet';
  const homeSection = sectionByKey[itemToSwapId];
  if (!homeSection) {
    return false;
  }

  const destinationSection = getSectionAtPosition(
    passiveDestinationPosition,
    positions,
    allKeys,
    sectionByKey,
    lockedKeys
  );

  if (!destinationSection) {
    return false;
  }

  return homeSection !== destinationSection;
}

export function hasSectionConstraints(
  sectionByKey: Record<string, string>
): boolean {
  'worklet';
  for (const _key in sectionByKey) {
    return true;
  }
  return false;
}

function isKeyLockedAtPosition(
  position: number,
  positions: Record<string, number>,
  lockedKeys: Record<string, boolean>,
  allKeys: string[]
): boolean {
  'worklet';
  const keyAtPosition = allKeys.find((k) => positions[k] === position);
  if (!keyAtPosition) {
    return false;
  }
  return lockedKeys[keyAtPosition] === true;
}

function findNextUnlockedPosition(
  from: number,
  direction: 1 | -1,
  totalCount: number,
  positions: Record<string, number>,
  lockedKeys: Record<string, boolean>,
  allKeys: string[]
): number | null {
  'worklet';
  let pos = from + direction;
  while (pos >= 0 && pos < totalCount) {
    if (!isKeyLockedAtPosition(pos, positions, lockedKeys, allKeys)) {
      return pos;
    }
    pos += direction;
  }
  return null;
}

function resolveDraggableTargetPosition(
  rawPosition: number,
  currentPosition: number,
  positions: Record<string, number>,
  lockedKeys: Record<string, boolean>,
  allKeys: string[],
  totalCount: number
): number {
  'worklet';
  const clampedRaw = Math.max(0, Math.min(rawPosition, totalCount - 1));

  if (!isKeyLockedAtPosition(clampedRaw, positions, lockedKeys, allKeys)) {
    return clampedRaw;
  }

  // Finger over a locked header: land at the first draggable slot below it
  // (symmetric regardless of drag direction).
  const below = findNextUnlockedPosition(
    clampedRaw,
    1,
    totalCount,
    positions,
    lockedKeys,
    allKeys
  );
  if (below !== null) {
    return below;
  }

  const above = findNextUnlockedPosition(
    clampedRaw,
    -1,
    totalCount,
    positions,
    lockedKeys,
    allKeys
  );
  return above ?? currentPosition;
}

/** Reorder flat list by removing dragged item and inserting at target index. */
export function insertDraggedAtFlatPosition(
  draggedId: string,
  targetFlatPosition: number,
  positions: Record<string, number>,
  allKeys: string[],
  totalCount: number,
  lockedKeys: Record<string, boolean>,
  dragDisabledKeys: Record<string, boolean> = {}
): Record<string, number> {
  'worklet';
  const currentPosition = positions[draggedId] ?? 0;
  let target = Math.max(0, Math.min(targetFlatPosition, totalCount - 1));

  const keyAtTarget = getKeyAtPosition(target, positions, allKeys);
  if (keyAtTarget && lockedKeys[keyAtTarget]) {
    target = resolveDraggableTargetPosition(
      target,
      currentPosition,
      positions,
      lockedKeys,
      allKeys,
      totalCount
    );
  }

  const order: string[] = [];
  for (let i = 0; i < totalCount; i++) {
    const key = getKeyAtPosition(i, positions, allKeys);
    if (key) {
      order.push(key);
    }
  }

  order.splice(currentPosition, 1);

  const keyAtResolvedTarget = getKeyAtPosition(target, positions, allKeys);
  let insertAt: number;

  if (keyAtResolvedTarget && dragDisabledKeys[keyAtResolvedTarget]) {
    const dropIndex = order.indexOf(keyAtResolvedTarget);
    if (dropIndex === -1) {
      return positions;
    }
    // Moving down: insert after drop zone (placeholder stays under header).
    // Moving up: insert before drop zone so the item can enter/pass the section.
    insertAt = currentPosition < target ? dropIndex + 1 : dropIndex;
  } else {
    if (target === currentPosition) {
      return positions;
    }
    insertAt = target;
    if (currentPosition < target) {
      insertAt = target - 1;
    }
  }

  insertAt = Math.max(0, Math.min(insertAt, order.length));
  order.splice(insertAt, 0, draggedId);

  const newPositions: Record<string, number> = {};
  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    if (id !== undefined) {
      newPositions[id] = i;
    }
  }

  if (newPositions[draggedId] === currentPosition) {
    return positions;
  }

  return newPositions;
}

export function swapOneStepTowardTarget(
  id: string,
  targetPosition: number,
  positions: Record<string, number>,
  allKeys: string[],
  totalCount: number,
  lockedKeys: Record<string, boolean>,
  sectionByKey: Record<string, string>,
  dragDisabledKeys: Record<string, boolean> = {}
): Record<string, number> {
  'worklet';
  const currentPosition = positions[id] ?? 0;
  const clampedTarget = Math.max(0, Math.min(targetPosition, totalCount - 1));

  if (currentPosition === clampedTarget) {
    return positions;
  }

  const direction: 1 | -1 = currentPosition < clampedTarget ? 1 : -1;
  const nextPosition = findNextUnlockedPosition(
    currentPosition,
    direction,
    totalCount,
    positions,
    lockedKeys,
    allKeys
  );

  if (nextPosition === null) {
    return positions;
  }

  const itemToSwapId = allKeys.find((key) => positions[key] === nextPosition);

  if (!itemToSwapId || itemToSwapId === id || lockedKeys[itemToSwapId]) {
    return positions;
  }

  // Drop targets (e.g. empty-section placeholders) must not be swapped away.
  if (dragDisabledKeys[itemToSwapId]) {
    return positions;
  }

  if (
    hasSectionConstraints(sectionByKey) &&
    wouldPassiveSwapCrossSection(
      itemToSwapId,
      currentPosition,
      sectionByKey,
      positions,
      allKeys,
      lockedKeys
    )
  ) {
    return positions;
  }

  const newPositions = { ...positions };
  newPositions[id] = nextPosition;
  newPositions[itemToSwapId] = currentPosition;
  return newPositions;
}

/** Pairwise swap when allowed; otherwise flat insert one step toward target. */
export function moveDraggedOneStepTowardTarget(
  id: string,
  targetPosition: number,
  positions: Record<string, number>,
  allKeys: string[],
  totalCount: number,
  lockedKeys: Record<string, boolean>,
  sectionByKey: Record<string, string>,
  dragDisabledKeys: Record<string, boolean> = {}
): Record<string, number> {
  'worklet';
  const currentPosition = positions[id] ?? 0;
  const swapped = swapOneStepTowardTarget(
    id,
    targetPosition,
    positions,
    allKeys,
    totalCount,
    lockedKeys,
    sectionByKey,
    dragDisabledKeys
  );

  if ((swapped[id] ?? 0) !== currentPosition) {
    return swapped;
  }

  const direction: 1 | -1 = currentPosition < targetPosition ? 1 : -1;
  const nextPosition = findNextUnlockedPosition(
    currentPosition,
    direction,
    totalCount,
    positions,
    lockedKeys,
    allKeys
  );

  if (nextPosition === null) {
    return positions;
  }

  return insertDraggedAtFlatPosition(
    id,
    nextPosition,
    positions,
    allKeys,
    totalCount,
    lockedKeys,
    dragDisabledKeys
  );
}

export function commitDropPositionWithSections(
  id: string,
  targetFlatPosition: number,
  positions: Record<string, number>,
  allKeys: string[],
  totalCount: number,
  lockedKeys: Record<string, boolean>,
  _sectionByKey: Record<string, string>,
  dragDisabledKeys: Record<string, boolean> = {}
): Record<string, number> {
  'worklet';
  const clampedTarget = Math.max(
    0,
    Math.min(targetFlatPosition, totalCount - 1)
  );

  return insertDraggedAtFlatPosition(
    id,
    clampedTarget,
    positions,
    allKeys,
    totalCount,
    lockedKeys,
    dragDisabledKeys
  );
}
