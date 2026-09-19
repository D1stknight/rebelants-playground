#!/bin/bash
# renders every faction × chassis to /home/claude/kart/out2/<f>_<k>/ then assembles sheets into /home/claude/kart/sheets/
cd /home/claude/kart
declare -A PAINT=( [ashigaru]=2e7d32 [ronin]=37474f [samurai]=c0392b [bushi]=1565c0 [warrior]=6d1b1b [shogun]=6a1b9a [buke]=00897b [kenshi]=e65100 [wokou]=004d40 [sohei]=f9a825 [yamabushi]=4e342e )
declare -A ACC=( [ashigaru]=ffd166 [ronin]=ff5252 [samurai]=ffd166 [bushi]=ffffff [warrior]=ffb300 [shogun]=ffd700 [buke]=b2ff59 [kenshi]=fff176 [wokou]=80cbc4 [sohei]=ffffff [yamabushi]=a5d6a7 )
mkdir -p out2 sheets2
for f in ashigaru ronin samurai bushi warrior shogun buke kenshi wokou sohei yamabushi; do
  for k in scout soldier tank drone royal; do
    if [ -f sheets2/kart_${f}_${k}.png ]; then continue; fi
    timeout 240 node kart_render.js $f $k ${PAINT[$f]} ${ACC[$f]} out2/${f}_${k} 16 > out2/${f}_${k}.log 2>&1
    python3 assemble.py out2/${f}_${k} sheets2/kart_${f}_${k}.png 4.6 >> out2/${f}_${k}.log 2>&1
    echo "$f $k $(tail -1 out2/${f}_${k}.log)"
  done
done
echo ALLDONE
