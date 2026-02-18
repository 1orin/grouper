const GENERATIONS = 30
const RANDOM_MUTATIONS = 2
const MAX_DESCENDANTS_TO_EXPLORE = 100

/**
 * Attempt to quickly approach a solution for the social golfer problem in the given
 * configuration.
 *
 * @param {number} groups how many groups per round
 * @param {number} ofSize how many players per group (target/max size)
 * @param {number} forRounds how many rounds to compute
 * @param {boolean} withGroupLeaders gives the first <groups> players a special role.
 *        It will never match any pair of them, quickly assigning one to each group
 *        when generating permutations.
 * @param {number[][]} forbiddenPairs gives pairs of players that should never be grouped.
 *        These pairs are seeded with infinite weight.
 * @param {number[][]} discouragedGroups gives groups of players that should be discouraged,
 *        by default; each pairs is seeded with weight 1.
 * @param {function} onProgress is a callback for reporting partial or full results.
 * @param {number} [numPlayers] actual number of players. When less than groups*ofSize,
 *        groups are balanced so sizes differ by at most 1.
 */
function geneticSolver(
  groups, ofSize, forRounds, withGroupLeaders,
  forbiddenPairs=[], discouragedGroups=[], onProgress, numPlayers
  ) {
  // When numPlayers is provided and less than groups*ofSize, create balanced groups.
  // Otherwise fall back to uniform groups of exactly ofSize.
  const totalSize = (numPlayers != null && numPlayers > 0)
    ? Math.min(numPlayers, groups * ofSize)
    : groups * ofSize;

  // Compute balanced group sizes: first `remainder` groups get one extra member
  const baseGroupSize = Math.floor(totalSize / groups);
  const numLargerGroups = totalSize % groups;
  const groupSizes = _.range(groups).map(i => i < numLargerGroups ? baseGroupSize + 1 : baseGroupSize);

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
   * Groups are balanced: sizes differ by at most 1.
   *
   * When withGroupLeaders is set, the first <num_groups> players are deterministically
   * assigned to their groups while the rest are shuffled.
   */
  function generatePermutation() {
    const shuffleStart = withGroupLeaders ? groups : 0;
    const shuffledPeople = _.shuffle(_.range(shuffleStart, totalSize));
    let offset = 0;
    return _.range(groups).map(i => {
      const group = [];
      if (withGroupLeaders) {
        group.push(i);
      }
      const membersToAdd = groupSizes[i] - (withGroupLeaders ? 1 : 0);
      group.push(...shuffledPeople.slice(offset, offset + membersToAdd));
      offset += membersToAdd;
      return group;
    });
  }

  /**
   * Swap the player at position p1 in group g1 with the player at position p2 in group g2.
   */
  function swapMembers(groupsArr, g1, p1, g2, p2) {
    const copy = groupsArr.map(group => group.slice())
    copy[g1][p1] = groupsArr[g2][p2]
    copy[g2][p2] = groupsArr[g1][p1]
    return copy
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
        for (let g = 1; g < sorted.length; g++) {
          for (let j = 0; j < sorted[g].length; j++) {
            if (withGroupLeaders && j == 0) continue;
            mutations.push(score(swapMembers(sorted, 0, i, g, j), weights))
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
    for (let i = 0; i < groups - 1; i++) {
      for (let j = i + 1; j < groups; j++) {
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
