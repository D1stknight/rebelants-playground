#!/bin/bash
# renders every faction × chassis F1 car (16 angles) and assembles public/rgp/cars/car_<f>_<k>.webp
# needs pages/dev/f1.tsx (copy of dev-f1-page.tsx) on a dev server at :3111. Usage: render_all_f1.sh [faction ...]
cd "$(dirname "$0")"; OUT=../../public/rgp/cars; TMP=${TMP_F1:-/tmp/f1render}; mkdir -p $OUT $TMP
declare -A PAINT=( [ashigaru]=2e7d32 [ronin]=37474f [samurai]=c0392b [bushi]=1565c0 [warrior]=6d1b1b [shogun]=6a1b9a [buke]=00897b [kenshi]=e65100 [wokou]=004d40 [sohei]=f9a825 [yamabushi]=4e342e )
declare -A ACC=( [ashigaru]=ffd166 [ronin]=ff5252 [samurai]=ffd166 [bushi]=ffffff [warrior]=ffb300 [shogun]=ffd700 [buke]=b2ff59 [kenshi]=fff176 [wokou]=80cbc4 [sohei]=ffffff [yamabushi]=a5d6a7 )
declare -A NUM=( [ashigaru]=4 [ronin]=13 [samurai]=7 [bushi]=11 [warrior]=33 [shogun]=1 [buke]=23 [kenshi]=16 [wokou]=77 [sohei]=55 [yamabushi]=44 )
FS=${@:-ashigaru ronin samurai bushi warrior shogun buke kenshi wokou sohei yamabushi}
for f in $FS; do
  for k in scout soldier tank drone royal; do
    [ -f $OUT/car_${f}_${k}.webp ] && continue
    rm -rf $TMP/${f}_${k}
    NUM=${NUM[$f]} timeout 300 node f1_render.js $f $k ${PAINT[$f]} ${ACC[$f]} $TMP/${f}_${k} 16 > $TMP/${f}_${k}.log 2>&1 && python3 assemble_f1.py $TMP/${f}_${k} $OUT/car_${f}_${k}.webp >> $TMP/${f}_${k}.log 2>&1
    echo "$f $k $(ls -la $OUT/car_${f}_${k}.webp 2>/dev/null | awk '{print $5}')"
  done
done
echo ALLDONE
