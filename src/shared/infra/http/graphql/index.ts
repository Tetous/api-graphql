import {
  ApolloServer as Apollo,
  ApolloError,
  CorsOptions,
} from 'apollo-server';
import { fileLoader } from 'merge-graphql-schemas';
import redis from 'redis';
import { buildSchema } from 'type-graphql';

import { serverConfig } from '@config';

import { AuthenticationAssurance } from '@modules/users/infra/http/middlewares/AuthenticationAssurance';

import { FileUtils } from '@shared/utils';

import { RateLimiter } from '../middlewares/RateLimiter';

export class ApolloServer {
  async connect(): Promise<Apollo> {
    const resolvers: any = fileLoader(
      FileUtils.getRootPath(
        'modules',
        '**',
        'infra',
        'http',
        'graphql',
        'resolvers',
        process.env.NODE_ENV === 'production' ? '*.js' : '*.ts',
      ),
    );

    const schema = await buildSchema({
      resolvers,
      authChecker: AuthenticationAssurance,
      globalMiddlewares: [RateLimiter],
    });

    const cors: CorsOptions = {
      credentials: true,
      origin: (requestOrigin, callback) => {
        if (
          process.env.NODE_ENV === 'development' ||
          process.env.NODE_ENV === 'testing'
        ) {
          callback(null, true);
        } else if (
          process.env.NODE_ENV === 'production' &&
          serverConfig.whitelist.indexOf(String(requestOrigin)) !== -1
        ) {
          callback(null, true);
        } else {
          callback(new ApolloError('Not allowed by CORS'));
        }
      },
    };

    const apolloServer = new Apollo({
      schema,
      cors,
      context: ({ req, res }) => ({
        redis: redis.createClient({
          host: process.env.REDIS_HOST,
          port: Number(process.env.REDIS_PORT),
          password: process.env.REDIS_PASS || undefined,
        }),
        url: `${req.protocol}://${req.get('host')}`,
        token: req.headers.authorization,
        req,
        res,
      }),
      playground: true,
    });

    apolloServer.setGraphQLPath('/');

    return apolloServer;
  }
}
