import stripe
from django.conf import settings
from django.urls import reverse
from mock import mock
from oscar.core.loading import get_class, get_model
from oscar.test.factories import CountryFactory

from ecommerce.extensions.checkout.utils import get_receipt_page_url
from ecommerce.extensions.order.constants import PaymentEventTypeName
from ecommerce.extensions.payment.constants import STRIPE_CARD_TYPE_MAP
from ecommerce.extensions.payment.processors.stripe import Stripe
from ecommerce.extensions.payment.tests.mixins import PaymentEventsMixin
from ecommerce.extensions.test.factories import create_basket
from ecommerce.tests.testcases import TestCase

Country = get_model('address', 'Country')
Order = get_model('order', 'Order')
PaymentEvent = get_model('order', 'PaymentEvent')
Selector = get_class('partner.strategy', 'Selector')
Source = get_model('payment', 'Source')


class StripeSubmitViewTests(PaymentEventsMixin, TestCase):
    path = reverse('stripe:submit')

    def setUp(self):
        super(StripeSubmitViewTests, self).setUp()
        self.user = self.create_user()
        self.client.login(username=self.user.username, password=self.password)

    def generate_form_data(self, basket_id):
        country = CountryFactory()
        return {
            'stripeToken': 'st_abc123',
            'basket': basket_id,
            'first_name': 'Test',
            'last_name': 'User',
            'address_line1': '141 Portland Ave.',
            'address_line2': 'Floor 9',
            'city': 'Cambridge',
            'state': 'MA',
            'postal_code': '02139',
            'country': country.iso_3166_1_a2,
        }

    def create_basket(self):
        basket = create_basket(owner=self.user, site=self.site)
        basket.strategy = Selector().strategy()
        basket.thaw()
        return basket

    def test_login_required(self):
        self.client.logout()
        response = self.client.post(self.path)
        expected_url = '{base}?next={path}'.format(base=self.get_full_url(path=reverse(settings.LOGIN_URL)),
                                                   path=self.path)
        self.assertRedirects(response, expected_url, fetch_redirect_response=False)

    @mock.patch('ecommerce.extensions.payment.processors.stripe.Stripe', mock.Mock(side_effect=Exception))
    def test_payment_error(self):
        basket = self.create_basket()
        data = self.generate_form_data(basket.id)
        response = self.client.post(self.path, data)
        self.assertRedirects(response, reverse('payment_error'), fetch_redirect_response=False)

    def test_successful_payment(self):
        basket = self.create_basket()
        data = self.generate_form_data(basket.id)
        card_type = 'American Express'
        label = '1986'
        charge = stripe.Charge.construct_from({
            'id': '2404',
            'source': {
                'brand': card_type,
                'last4': label,
            },
        }, 'fake-key')

        with mock.patch('stripe.Charge.create') as charge_mock:
            charge_mock.return_value = charge
            response = self.client.post(self.path, data)

        receipt_url = get_receipt_page_url(self.site_configuration, basket.order_number)
        self.assertRedirects(response, receipt_url, fetch_redirect_response=False)

        order = Order.objects.get(number=basket.order_number)
        total = basket.total_incl_tax
        order.payment_events.get(event_type__code='paid', amount=total)
        Source.objects.get(
            source_type__name=Stripe.NAME,
            currency=order.currency,
            amount_allocated=total,
            amount_debited=total,
            card_type=STRIPE_CARD_TYPE_MAP[card_type],
            label=label
        )
        PaymentEvent.objects.get(
            event_type__name=PaymentEventTypeName.PAID,
            amount=total,
            processor_name=Stripe.NAME
        )

        assert order.billing_address.first_name == data['first_name']
        assert order.billing_address.last_name == data['last_name']
        assert order.billing_address.line1 == data['address_line1']
        assert order.billing_address.line2 == data['address_line2']
        assert order.billing_address.line4 == data['city']
        assert order.billing_address.state == data['state']
        assert order.billing_address.postcode == data['postal_code']
        assert order.billing_address.country == Country.objects.get(iso_3166_1_a2=data['country'])
