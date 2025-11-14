node wallet-gen.js \
  --count 2 \
  --out-dir ./out_mnemonic_keystore_only \
  --modes mnemonic-generate,keystore \
  --keystore-password "123456"

node wallet-gen-from-mnemonic.js \
  --mnemonic "goose music bench regular globe sure rabbit novel tree country aspect insect" \
  --count 5 \
  --out-dir ./out_existing \
  --keystore-password "123456"

node unlock-keystore-verify.js \
  --in-dir ./out_existing/keystore \
  --password "123456"

./wallet-gen-zip.sh [COUNT] [OUT_DIR] [KEYSTORE_PASSWORD]
./wallet-gen-from-mnemonic-zip.sh [MNEMONIC] [COUNT] [OUT_DIR] [KEYSTORE_PASSWORD]

./wallet-gen-zip.sh 10 ./out_2 123456
./wallet-gen-from-mnemonic-zip.sh "goose music bench regular globe sure rabbit novel tree country aspect insect" 5 ./out_3 123456
