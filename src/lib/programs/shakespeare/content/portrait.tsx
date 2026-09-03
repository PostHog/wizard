/**
 * PORTRAIT_BLOCK — ASCII portrait shown first in the shakespeare Learn
 * deck. Fixed at 37 chars wide (14 rows) to fit the LearnCard pane at an
 * 80-column terminal — see the pane-width math in `LearnCard.tsx` and the
 * same convention self-driving's `PIPELINE_BLOCK` follows. Rendered as
 * exact `lines` (not a wrapped string) so word-wrap can't corrupt it.
 */

import { Text } from 'ink';
import { Colors } from '@ui/tui/styles';
import type { ContentBlock } from '@ui/tui/primitives/content-types';

const PORTRAIT_ROWS = [
  '%%%%%%%%%%%%%###=+*##%##%%%%%%%%%%%%%',
  '%%%%%%%%%%##:*###**=--*#####%%%%%%%%%',
  '%%%%%######:#%%%%%%#==:=#########%%%%',
  '%%%######-:+##%####*+:-.:=*########%%',
  '%#######+=:--+*=--=+=-:-..:**######%%',
  '%#####**=--*++*#**#*=::-:..:******###',
  '%###*****--+#%**#**+=:.:..:=*+*****##',
  '####***+*+=:-==:=**--=#+:.-=++*++*+*#',
  '####***+++*+-+**+-::+%*#*--++++*+++*#',
  '##****+++++*+.:--.-%%####..:++++++**#',
  '##***+++=:####:##%##%#%*:.:..::++==**',
  '##****-.::#:.#*.#.##*.:-.-:.::..:--+*',
  '%##*=:.=.+=.=..:.-:-:-:-==-=-:=:::==#',
  '%##*-.-....+.=-.:.::=+:=+-+:-+=+:*=+#',
];

export const PORTRAIT_BLOCK: ContentBlock = {
  type: 'lines',
  interval: 50,
  pause: 4000,
  lines: PORTRAIT_ROWS.map((row, i) => (
    <Text key={i} color={Colors.accent}>
      {row}
    </Text>
  )),
};
