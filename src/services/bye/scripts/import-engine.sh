DIR_ORIGEM='./../../../resources/engine-serverless'
DIR_DESTINO='./node_modules/engine-serverless'
DIR_MODULES='./node_modules/'

if  [  -d  "$DIR_ORIGEM"  ] ; then

  if  [  -d  "$DIR_DESTINO"  ] ; then
    rm -rf "$DIR_DESTINO"
  fi

  cp -R "$DIR_ORIGEM" "$DIR_MODULES"
fi
