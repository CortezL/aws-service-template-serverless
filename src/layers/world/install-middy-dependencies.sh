FOLDER_TO_MOVE=$(ls -d */)
cd $FOLDER_TO_MOVE
npm i
zip -r middy.zip .
mv middy.zip ../
