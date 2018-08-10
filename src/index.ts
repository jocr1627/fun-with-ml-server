import { ApolloServer } from 'apollo-server';
import schema from 'fun-with-ml-schema/src/index';
import { resolvers } from './resolvers';

const apolloResolvers = resolvers as any;
const server = new ApolloServer({
  resolvers: apolloResolvers,
  typeDefs: schema as any
});

server
  .listen()
  .then(
    ({ subscriptionsUrl, url }: { subscriptionsUrl: string; url: string }) => {
      console.log(`🚀  Server ready at ${url}`);
      console.log(`🚀  Subscriptions ready at ${subscriptionsUrl}`);
    }
  );
