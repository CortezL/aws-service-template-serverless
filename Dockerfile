FROM node:16.13.0

# RUN apt-get update && apt-get install vim -y && apt-get install nmap -y

WORKDIR /app

COPY . /app/

#Envia o arquivo credentials para a pasta .aws
RUN mkdir /root/.aws
COPY credentials /root/.aws/

# Configura as permissões do NPM
RUN npm config set user 0 && npm config set unsafe-perm true
# Instala o serverless
RUN npm install -g serverless
