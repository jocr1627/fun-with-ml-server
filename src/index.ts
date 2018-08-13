import { ApolloServer } from 'apollo-server';
import fs from 'fs';
import schema from 'fun-with-ml-schema/src/index';
import client from './db';
import { resolvers } from './resolvers';

const apolloResolvers = resolvers as any;
const server = new ApolloServer({
  resolvers: apolloResolvers,
  typeDefs: schema as any
});
const initSql = fs.readFileSync('init.sql', 'utf-8');

client.query(initSql).then(() => {
  server
    .listen({ port: process.env.PORT || 4000 })
    .then(
      ({
        subscriptionsUrl,
        url
      }: {
        subscriptionsUrl: string;
        url: string;
      }) => {
        console.log(`🚀  Server ready at ${url}`);
        console.log(`🚀  Subscriptions ready at ${subscriptionsUrl}`);
      }
    );
});
