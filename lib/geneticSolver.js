const GENERATIONS = 30
const RANDOM_MUTATIONS = 2
const MAX_DESCENDANTS_TO_EXPLORE = 100

/**
 * Attempt to quickly approach a solution for the social golfer problem in the given
 * configuration.
 *
 * @param {number} groups how many groups per round
 * @param {number} ofSize how many players per group (ideal/maximum size)
 * @param {number} forRounds how many rounds to compute
 * @param {boolean} withGroupLeaders gives the first <groups> players a special role.
 *        It will never match any pair of them, quickly assigning one to each group
 *        when generating permutations.
 * @param {number[][]} forbiddenPairs gives pairs of players that should never be grouped.
 *        These pairs are seeded with infinite weight.
 * @param {number[][]} discouragedGroups gives groups of players that should be discouraged,
 *        by default; each pairs is seeded with weight 1.
 * @param {function} onProgress is a callback for reporting partial or full results.
 * @param {number} totalPeople the actual number of people to distribute (optional, defaults to groups * ofSize)
 */
function geneticSolver(
  groups, ofSize, forRounds, withGroupLeaders,
  forbiddenPairs=[], discouragedGroups=[], onProgress, totalPeople
  ) {
  // Use provided totalPeople or calculate from groups * ofSize for backwards compatibility
  totalPeople = totalPeople !== undefined ? totalPeople : groups * ofSize;

  // Calculate actual number of groups (can't have more groups than people)
  const actualGroups = Math.min(groups, totalPeople);

  // Calculate how to distribute people across groups
  const baseSize = Math.floor(totalPeople / actualGroups);
  const extraPeople = totalPeople % actualGroups;

  // Create array of group sizes - first extraPeople groups get baseSize+1, rest get baseSize
  const groupSizes = [];
  for (let i = 0; i < actualGroups; i++) {
    groupSizes.push(i < extraPeople ? baseSize + 1 : baseSize);
  }

  const totalSize = totalPeople;

  // Weights represents the number of times a given pair has been grouped before,
  // or may sometimes have artificial constraints, like infinity weights for pairs
  // who should never be grouped.
  function score(round, weights) {
    const groupScores = round.map(group => {
      let groupCost = 0
      forEachPair(group, (a, b) => groupCost += Math.pow(weights[a][b], 2))
      return groupCost
    })
    return {
      groups: round,
      groupsScores: groupScores,
      total: groupScores.reduce((sum, next) => sum + next, 0),
    }
  }

  /**
   * Create a shuffled players-in-groups configuration, returned as nested arrays of integers.
   * For example, here are five groups of three:
   *
   *     [
   *       [5, 3, 13],
   *       [11, 1, 6],
   *       [8, 14, 12],
   *       [9, 4, 0],
   *       [2, 10, 7],
   *     ]
   *
   * When withGroupLeaders is set, the first <num_groups> players are deterministically
   * assigned to their groups while the rest are shuffled, producing something more like this:
   *
   *     [
   *       [0, 9, 13],
   *       [1, 11, 6],
   *       [2, 14, 12],
   *       [3, 8, 5],
   *       [4, 10, 7],
   *     ]
   *
   * With variable group sizes (when totalPeople != groups * ofSize), groups may have
   * different sizes, distributed as evenly as possible.
   */
  function generatePermutation() {
    const shuffleStart = withGroupLeaders ? actualGroups : 0;
    const shuffledPeople = _.shuffle(_.range(shuffleStart, totalSize));

    const result = [];
    let personIndex = 0;

    for (let i = 0; i < actualGroups; i++) {
      const group = [];

      // Add group leader if enabled
      if (withGroupLeaders) {
        group.push(i);
      }

      // Add the appropriate number of shuffled people for this group
      const groupSize = groupSizes[i];
      const peopleToAdd = withGroupLeaders ? groupSize - 1 : groupSize;

      for (let j = 0; j < peopleToAdd; j++) {
        if (personIndex < shuffledPeople.length) {
          group.push(shuffledPeople[personIndex++]);
        }
      }

      result.push(group);
    }

    return result;
  }

  /**
   * Helper function to convert a flat index to (groupIndex, indexWithinGroup)
   */
  function flatIndexToPosition(flatIndex, groups) {
    let remaining = flatIndex;
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      if (remaining < groups[groupIndex].length) {
        return { groupIndex, indexWithinGroup: remaining };
      }
      remaining -= groups[groupIndex].length;
    }
    throw new Error(`Index ${flatIndex} out of bounds`);
  }

  function generateMutations(candidates, weights) {
    const mutations = []
    candidates.forEach(candidate => {
      const scoredGroups = candidate.groups.map((g, i) => ({group: g, score: candidate.groupsScores[i]}))
      const sortedScoredGroups = _.sortBy(scoredGroups, sg => sg.score).reverse()
      const sorted = sortedScoredGroups.map(ssg => ssg.group)

      // Always push the original candidate back onto the list
      mutations.push(candidate)

      // Add every mutation that swaps somebody out of the most expensive group
      // (The first group is the most expensive now that we've sorted them)
      const expensiveGroup = sorted[0];
      for (let i = 0; i < expensiveGroup.length; i++) {
        if (withGroupLeaders && i == 0) continue;

        // Swap with people from other groups
        for (let otherGroupIdx = 1; otherGroupIdx < sorted.length; otherGroupIdx++) {
          for (let j = 0; j < sorted[otherGroupIdx].length; j++) {
            if (withGroupLeaders && j == 0) continue;
            mutations.push(score(swap(sorted, 0, i, otherGroupIdx, j), weights))
          }
        }
      }

      // Add some random mutations to the search space to help break out of local peaks
      for (let i = 0; i < RANDOM_MUTATIONS; i++) {
        mutations.push(score(generatePermutation(), weights))
      }
    })
    return mutations;
  }

  function swap(groups, groupI, indexI, groupJ, indexJ) {
    const copy = groups.map(group => group.slice())
    const temp = copy[groupI][indexI]
    copy[groupI][indexI] = copy[groupJ][indexJ]
    copy[groupJ][indexJ] = temp
    return copy
  }

  function updateWeights(round, weights) {
    for (const group of round) {
      forEachPair(group, (a, b) => {
        weights[a][b] = weights[b][a] = (weights[a][b] + 1)
      })
    }
  }

  const weights = _.range(totalSize).map(() => _.range(totalSize).fill(0))

  // Fill some initial restrictions
  if (withGroupLeaders) {
    // Forbid every pairwise combination of group leaders
    for (let i = 0; i < actualGroups - 1; i++) {
      for (let j = i + 1; j < actualGroups; j++) {
        weights[i][j] = weights[j][i] = Infinity;
      }
    }
  }

  forbiddenPairs.forEach(group => {
    forEachPair(group, (a, b) => {
      if (a >= totalSize || b >= totalSize) return
      weights[a][b] = weights[b][a] = Infinity
    })
  })

  discouragedGroups.forEach(group => {
    forEachPair(group, (a, b) => {
      if (a >= totalSize || b >= totalSize) return
      weights[a][b] = weights[b][a] = (weights[a][b] + 1)
    })
  })

  const rounds = []
  const roundScores = []

  for (let round = 0; round < forRounds; round++) {
    let topOptions = _.range(5).map(() => score(generatePermutation(), weights))
    let generation = 0
    while (generation < GENERATIONS && topOptions[0].total > 0) {
      const candidates = generateMutations(topOptions, weights)
      let sorted = _.sortBy(candidates, c => c.total)
      const bestScore = sorted[0].total
      // Reduce to all the options that share the best score
      topOptions = sorted.slice(0, sorted.findIndex(opt => opt.total > bestScore))
      // Shuffle those options and only explore some maximum number of them
      topOptions = _.shuffle(topOptions).slice(0, MAX_DESCENDANTS_TO_EXPLORE)
      generation++;
    }
    const bestOption  = topOptions[0]
    // For tidiness when using group leaders reorder results to keep leaders in order
    if (withGroupLeaders) {
      bestOption.groups.sort((a, b) => a[0] - b[0]);
    }
    rounds.push(bestOption.groups)
    roundScores.push(bestOption.total)
    updateWeights(bestOption.groups, weights)

    onProgress({
      rounds,
      roundScores,
      weights,
      done: (round+1) >= forRounds,
    })
  }
}

function forEachPair(array, callback) {
  for (let i = 0; i < array.length - 1; i++) {
    for (let j = i + 1; j < array.length; j++) {
      callback(array[i], array[j])
    }
  }
}
