"""HTTP endpoints for interacting with products."""
from django.db.models import Q
from oscar.core.loading import get_model
from rest_framework import filters, status
from rest_framework.decorators import detail_route, list_route
from rest_framework.permissions import IsAdminUser, IsAuthenticated
from rest_framework.response import Response
from rest_framework_extensions.mixins import NestedViewSetMixin

from ecommerce.extensions.api import serializers
from ecommerce.extensions.api.filters import ProductFilter
from ecommerce.extensions.api.v2.views import NonDestroyableModelViewSet

Product = get_model('catalogue', 'Product')

import logging
log = logging.getLogger('MLOTURCO LOGGER')

class ProductViewSet(NestedViewSetMixin, NonDestroyableModelViewSet):
    serializer_class = serializers.ProductSerializer
    filter_backends = (filters.DjangoFilterBackend,)
    filter_class = ProductFilter
    permission_classes = ()#IsAuthenticated, IsAdminUser,)

    def get_queryset(self):
        self.queryset = Product.objects.all()
        # We are calling the super's .get_queryset() in case of nested
        # products so that they are propery filtered by parent ID first.
        # Products are then filtered by:
        #   - stockrecord partner: for products that have stockrecords (seats, coupons, ...)
        #   - course site: for products that don't have a stockrecord (parent course)
        return super(ProductViewSet, self).get_queryset().filter(
            Q(stockrecords__partner=self.request.site.siteconfiguration.partner) |
            Q(course__site=self.request.site)
        )

    
    #Is actually create or update :/
    def create(self, request):
        log.info('hit create or update')
        log.info('request.data is %s',str(request.data))

        serializer = self.serializer_class(data=request.data, context = {'request': request})
        if serializer.is_valid():
                serializer.save()
                log.info('added product with data: %s',serializer.data)
                Response({'status': 'you hit and saved'})
        else:
            return Response(serializer.errors,
                            status=status.HTTP_400_BAD_REQUEST)